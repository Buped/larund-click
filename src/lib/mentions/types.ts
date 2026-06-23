// Structured inline references ("mentions") shared by the Chat composer and the
// Automation editor. A mention looks like a chip in text but carries structured
// metadata so the agent runtime receives real context (skill body, connection
// status, MCP tools, memory content, workflow steps, file reference) rather than
// just a label.

export type MentionKind =
  | 'app'
  | 'skill'
  | 'connection'
  | 'mcp'
  | 'memory'
  | 'workflow'
  | 'web_source'
  | 'x_post'
  | 'x_user'
  | 'file'
  | 'folder'
  | 'drive_file'
  | 'drive_folder';

export interface ReferencedContext {
  id: string;
  kind: MentionKind;
  /** Short human label shown in the chip (e.g. "Google Sheets"). */
  label: string;
  /** Id of the underlying resource (skill id, provider id, server id, …). */
  refId: string;
  /** The text inserted into the prompt for this reference (e.g. "@Google Sheets"). */
  displayText: string;
  metadata?: Record<string, unknown>;
  snapshot?: unknown;
  insertedAt: string;
  status?: 'available' | 'needs_setup' | 'disabled' | 'missing';
  resolvedAtSendTime?: boolean;
}

/** A pickable resource surfaced in the mention dropdown. */
export interface MentionResource {
  kind: MentionKind;
  refId: string;
  label: string;
  /** Optional secondary line (status, category, …). */
  detail?: string;
  /** True when the resource is usable right now (connected skill enabled, etc.). */
  available: boolean;
  metadata?: Record<string, unknown>;
}

export const MENTION_COLORS: Record<MentionKind, string> = {
  app: '#22D3EE',        // cyan
  skill: '#A78BFA',     // purple
  connection: '#4A9EFF', // blue
  mcp: '#34BE78',        // green
  memory: '#F5A524',     // yellow
  workflow: '#FB923C',   // orange
  web_source: '#4A9EFF',
  x_post: '#111111',
  x_user: '#111111',
  file: '#9CA3AF',       // gray
  folder: '#9CA3AF',     // gray
  drive_file: '#34A853',  // Google Drive green
  drive_folder: '#34A853',
};

export const MENTION_TABS: Array<{ kind: MentionKind; label: string }> = [
  { kind: 'app', label: 'Apps' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'connection', label: 'Connections' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'workflow', label: 'Workflows' },
  { kind: 'web_source', label: 'Sources' },
  { kind: 'x_post', label: 'X posts' },
  { kind: 'x_user', label: 'X users' },
];

let counter = 0;
export function newReferenceId(): string {
  return `ref-${Date.now()}-${(counter++).toString(36)}`;
}

export function resourceToReference(r: MentionResource): ReferencedContext {
  return {
    id: newReferenceId(),
    kind: r.kind,
    label: r.label,
    refId: r.refId,
    displayText: `@${r.label}`,
    metadata: { ...r.metadata, detail: r.detail },
    insertedAt: new Date().toISOString(),
    status: r.available ? 'available' : 'needs_setup',
    resolvedAtSendTime: true,
  };
}
