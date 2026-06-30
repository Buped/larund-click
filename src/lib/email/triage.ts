// AI inbox triage: fetch recent inbox messages via the existing Gmail tools, ask a
// cheap model to categorize + summarize + prioritize each, and (on explicit user
// action) apply the suggested Gmail labels. No automatic mutation happens here —
// triageInbox is read-only; applyTriageLabels is the gated external_write step.

import { createConnectionRegistry } from '../connections/registry';
import { callOpenRouterJson } from '../openrouter';
import { MODELS } from '../../constants/models';

const TRIAGE_MODEL = MODELS[0].openrouter_id; // cheap/fast tier

export type TriagePriority = 'high' | 'medium' | 'low';

export interface TriageItem {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  category: string;
  priority: TriagePriority;
  summary: string;
  suggestedLabel: string;
}

export interface TriageResult {
  items: TriageItem[];
  error?: string;
}

interface RawMessage { id: string; from?: string; subject?: string; snippet?: string }

/** Pull the first JSON array/object out of a model reply, tolerating ```fences```. */
function parseJsonLoose(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : content).trim();
  try { return JSON.parse(text); } catch { /* try to slice an array */ }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

function normPriority(v: unknown): TriagePriority {
  const s = String(v ?? '').toLowerCase();
  if (s.startsWith('h') || s.includes('magas') || s.includes('sürg')) return 'high';
  if (s.startsWith('l') || s.includes('alacsony')) return 'low';
  return 'medium';
}

/**
 * Read the most recent inbox messages and ask the model to triage them. Read-only:
 * it never modifies the mailbox. Returns one TriageItem per message (best-effort —
 * messages the model omits fall back to neutral defaults so nothing is dropped).
 */
export async function triageInbox(
  userId: string,
  opts: { projectId?: string; query?: string; maxResults?: number } = {},
): Promise<TriageResult> {
  const registry = createConnectionRegistry(userId, opts.projectId);
  const max = Math.min(opts.maxResults ?? 20, 50);
  const search = await registry.call('google-workspace', 'google.gmail.search', {
    query: opts.query ?? 'in:inbox',
    max_results: max,
  });
  if (!search.success) {
    return { items: [], error: search.error || search.output || 'gmail_search_failed' };
  }
  const messages = ((search.details as { messages?: RawMessage[] } | undefined)?.messages ?? [])
    .filter((m) => m && m.id);
  if (messages.length === 0) return { items: [] };

  const fallback = (m: RawMessage): TriageItem => ({
    id: m.id,
    from: m.from ?? '',
    subject: m.subject ?? '(tárgy nélkül)',
    snippet: m.snippet ?? '',
    category: 'Egyéb',
    priority: 'medium',
    summary: m.snippet ?? '',
    suggestedLabel: 'Egyéb',
  });

  let parsed: unknown = null;
  try {
    const list = messages.map((m, i) => `${i}. FROM: ${m.from ?? ''}\n   SUBJECT: ${m.subject ?? ''}\n   SNIPPET: ${(m.snippet ?? '').slice(0, 200)}`).join('\n');
    const { content } = await callOpenRouterJson(
      [
        {
          role: 'system',
          content:
            'You triage a user\'s email inbox. For EACH numbered message reply with one JSON object. ' +
            'Return ONLY a JSON array (no prose) of objects with keys: ' +
            '"index" (number, matching the input), "category" (short Hungarian noun e.g. "Ügyfél", "Számla", "Hírlevél", "Belső", "Toborzás", "Egyéb"), ' +
            '"priority" ("high"|"medium"|"low"), "summary" (one short Hungarian sentence), ' +
            '"suggestedLabel" (a concise Gmail label name, Hungarian). Keep categories consistent and reusable.',
        },
        { role: 'user', content: list },
      ],
      TRIAGE_MODEL,
      userId,
    );
    parsed = parseJsonLoose(content);
  } catch (e) {
    // Model unavailable / offline: still return the messages with neutral defaults
    // so the inbox list renders; surface the reason.
    return { items: messages.map(fallback), error: `triage_model_failed: ${String((e as Error)?.message ?? e)}` };
  }

  const byIndex = new Map<number, Record<string, unknown>>();
  if (Array.isArray(parsed)) {
    parsed.forEach((row, i) => {
      if (row && typeof row === 'object') {
        const o = row as Record<string, unknown>;
        const idx = typeof o.index === 'number' ? o.index : i;
        byIndex.set(idx, o);
      }
    });
  }

  const items = messages.map((m, i) => {
    const o = byIndex.get(i);
    if (!o) return fallback(m);
    const category = String(o.category ?? '').trim() || 'Egyéb';
    return {
      id: m.id,
      from: m.from ?? '',
      subject: m.subject ?? '(tárgy nélkül)',
      snippet: m.snippet ?? '',
      category,
      priority: normPriority(o.priority),
      summary: String(o.summary ?? m.snippet ?? '').trim(),
      suggestedLabel: String(o.suggestedLabel ?? category).trim() || category,
    };
  });
  return { items };
}

export interface ApplyLabelsResult {
  applied: number;
  errors: string[];
}

/**
 * Apply each item's suggested label to its message. Ensures the label exists first
 * (idempotent create), then adds it via modify_labels. external_write — call only
 * from an explicit user action. Labels are created/added; nothing is removed.
 */
export async function applyTriageLabels(
  userId: string,
  items: Array<Pick<TriageItem, 'id' | 'suggestedLabel'>>,
  opts: { projectId?: string } = {},
): Promise<ApplyLabelsResult> {
  const registry = createConnectionRegistry(userId, opts.projectId);
  const errors: string[] = [];

  // Resolve existing labels → name→id map; create missing ones once.
  const labelIdByName = new Map<string, string>();
  const listed = await registry.call('google-workspace', 'google.gmail.list_labels', {});
  if (listed.success) {
    const labels = (listed.details as { labels?: Array<{ id?: string; name?: string }> } | undefined)?.labels ?? [];
    for (const l of labels) if (l.name && l.id) labelIdByName.set(l.name, l.id);
  }

  async function ensureLabelId(name: string): Promise<string | null> {
    if (labelIdByName.has(name)) return labelIdByName.get(name)!;
    const created = await registry.call('google-workspace', 'google.gmail.create_label', { name });
    if (!created.success) { errors.push(`Címke létrehozása sikertelen (${name}): ${created.error ?? created.output}`); return null; }
    const id = String((created.details as { id?: string } | undefined)?.id ?? '');
    if (id) labelIdByName.set(name, id);
    return id || null;
  }

  // Group messages by suggested label so each label is ensured once.
  const byLabel = new Map<string, string[]>();
  for (const it of items) {
    const name = (it.suggestedLabel || '').trim();
    if (!name) continue;
    const arr = byLabel.get(name) ?? [];
    arr.push(it.id);
    byLabel.set(name, arr);
  }

  let applied = 0;
  for (const [name, ids] of byLabel) {
    const labelId = await ensureLabelId(name);
    if (!labelId) continue;
    const res = await registry.call('google-workspace', 'google.gmail.modify_labels', {
      messageIds: ids,
      addLabelIds: [labelId],
    });
    if (res.success) applied += ids.length;
    else errors.push(`Címkézés sikertelen (${name}): ${res.error ?? res.output}`);
  }

  return { applied, errors };
}
