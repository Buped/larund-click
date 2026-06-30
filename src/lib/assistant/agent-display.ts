export interface AgentDisplayStep {
  id: string;
  type: string;
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface VisibleThinking {
  content: string;
}

export interface CloudPreviewAttachment {
  kind: 'google_doc' | 'google_sheet';
  title: string;
  url: string;
  providerId: string;
  verified: boolean;
  textPreview?: string;
  rowsPreview?: string[][];
  rowCount?: number;
}

const THINKING_NOISE = [
  /^structured execution is ready\b/i,
  /^preparing the task target\b/i,
  /^verification (failed|passed):/i,
  /^no google docs create\/update action succeeded/i,
  /^google doc content was confirmed/i,
  /^google sheets? .*read-back/i,
];

function cleanThinkingLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function thinkingFromAgentSteps(steps: AgentDisplayStep[]): VisibleThinking | undefined {
  const parts = steps
    .filter((step) => ['thinking', 'plan', 'checklist'].includes(step.type))
    .map((step) => cleanThinkingLine(step.output ?? ''))
    .filter((value) => value && !THINKING_NOISE.some((re) => re.test(value)));
  if (parts.length === 0) return undefined;
  return { content: parts.join('\n\n') };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRows(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? '')));
  return rows.length ? rows : undefined;
}

function parseJsonRecord(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function actionFromStep(step: AgentDisplayStep): Record<string, unknown> | undefined {
  return parseJsonRecord(step.input);
}

function googleDocUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/edit`;
}

function googleSheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function outputTextPreview(step: AgentDisplayStep, details: Record<string, unknown>): string | undefined {
  const fromDetails = asString(details.text);
  if (fromDetails) return fromDetails.slice(0, 700);
  const parsed = parseJsonRecord(step.output);
  const parsedText = asString(parsed?.text);
  if (parsedText) return parsedText.slice(0, 700);
  const raw = asString(step.output);
  if (!raw || raw.startsWith('{')) return undefined;
  return raw.slice(0, 700);
}

function rowsFromStep(step: AgentDisplayStep, details: Record<string, unknown>): string[][] | undefined {
  return asRows(details.values)
    ?? asRows(details.readBack)
    ?? asRows(parseJsonRecord(step.output)?.values);
}

function titleFromSheetDetails(details: Record<string, unknown>, fallback?: string): string | undefined {
  const direct = asString(details.title);
  if (direct) return direct;
  const properties = asRecord(details.properties);
  return asString(properties?.title) ?? fallback;
}

function mergePreview(existing: CloudPreviewAttachment | undefined, next: CloudPreviewAttachment): CloudPreviewAttachment {
  if (!existing) return next;
  const genericTitle = next.title === 'Google Document' || next.title === 'Google Sheet';
  return {
    ...existing,
    ...next,
    verified: existing.verified || next.verified,
    title: genericTitle ? existing.title : (next.title || existing.title),
    url: next.url || existing.url,
    textPreview: next.textPreview ?? existing.textPreview,
    rowsPreview: next.rowsPreview ?? existing.rowsPreview,
    rowCount: next.rowCount ?? existing.rowCount,
  };
}

export function cloudPreviewsFromAgentSteps(steps: AgentDisplayStep[]): CloudPreviewAttachment[] {
  const calls = new Map<string, Record<string, unknown>>();
  for (const step of steps) {
    if (step.type !== 'tool_call' || step.tool !== 'connection.call') continue;
    const action = actionFromStep(step);
    if (action?.connection === 'google-workspace') calls.set(`${step.id}-result`, action);
  }

  const previews = new Map<string, CloudPreviewAttachment>();
  for (const step of steps) {
    if (step.type !== 'tool_result' || step.tool !== 'connection.call') continue;
    const action = calls.get(step.id);
    const tool = asString(action?.tool);
    if (!tool) continue;
    const args = asRecord(action?.args) ?? {};
    const details = step.details ?? {};

    if (tool.startsWith('google.docs.')) {
      const id = asString(details.documentId) ?? asString(details.document_id) ?? asString(args.documentId) ?? asString(args.document_id);
      if (!id) continue;
      const url = asString(details.url) ?? asString(details.webViewLink) ?? googleDocUrl(id);
      const title = asString(details.title) ?? asString(args.title) ?? 'Google Document';
      const textPreview = tool === 'google.docs.read' ? outputTextPreview(step, details) : undefined;
      const verified = Boolean(details.verified) || tool === 'google.docs.read' || /read-back:\s*(✓|meger|verified)/i.test(step.output ?? '');
      const key = `google_doc:${id}`;
      previews.set(key, mergePreview(previews.get(key), {
        kind: 'google_doc',
        providerId: id,
        title,
        url,
        verified,
        textPreview,
      }));
    }

    if (tool.startsWith('google.sheets.')) {
      const id = asString(details.spreadsheetId) ?? asString(details.spreadsheet_id) ?? asString(args.spreadsheetId) ?? asString(args.spreadsheet_id);
      if (!id) continue;
      const url = asString(details.spreadsheetUrl) ?? asString(details.url) ?? googleSheetUrl(id);
      const title = titleFromSheetDetails(details, asString(args.title)) ?? 'Google Sheet';
      const rows = rowsFromStep(step, details);
      const rowCount = asNumber(details.rowCount) ?? asNumber(details.readRows) ?? rows?.length;
      const verified = Boolean(details.verified) || tool === 'google.sheets.read_values' || /read-back:\s*\d+\s*rows.*verified/i.test(step.output ?? '');
      const key = `google_sheet:${id}`;
      previews.set(key, mergePreview(previews.get(key), {
        kind: 'google_sheet',
        providerId: id,
        title,
        url,
        verified,
        rowsPreview: rows?.slice(0, 5).map((row) => row.slice(0, 6)),
        rowCount,
      }));
    }
  }

  return [...previews.values()];
}
