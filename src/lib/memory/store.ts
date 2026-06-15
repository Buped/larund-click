// Memory store. CRUD + lifecycle + querying over the shared coworker backend,
// plus relevance retrieval that delegates to the (pure) retriever. Phase 2 adds
// the suggestion/review lifecycle and memory operations (merge, dedupe,
// contradiction, supersede, export/import).

import { recordBackend, type RecordRow } from '../coworker/persistence';
import type {
  CreateMemoryInput,
  MemoryEntry,
  MemoryPatch,
  MemoryQuery,
  MemoryScope,
  MemoryStatus,
  RelevantMemoryQuery,
  ScoredMemory,
} from './types';
import { rankMemories, tokenize } from './retriever';

const COLLECTION = 'memory_entries';

/** Normalize a stored row into a fully-populated entry (Phase 1 back-compat). */
function toEntry(row: RecordRow): MemoryEntry {
  const e = row as unknown as MemoryEntry & { archived?: boolean };
  const status: MemoryStatus = e.status ?? (e.archived ? 'archived' : 'active');
  const scope: MemoryScope = e.scope ?? (e.workspaceId ? 'workspace' : 'global');
  return {
    ...e,
    status,
    scope,
    sensitivity: e.sensitivity ?? 'normal',
    writePolicy: e.writePolicy ?? 'manual_only',
    pinned: e.pinned ?? false,
    archived: status === 'archived',
    tags: e.tags ?? [],
  };
}

async function put(entry: MemoryEntry): Promise<MemoryEntry> {
  entry.archived = entry.status === 'archived';
  await recordBackend().put(COLLECTION, entry as unknown as RecordRow);
  return entry;
}

export async function createMemory(input: CreateMemoryInput): Promise<MemoryEntry> {
  const now = new Date().toISOString();
  const status = input.status ?? 'active';
  const entry: MemoryEntry = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    skillId: input.skillId,
    type: input.type,
    title: input.title.trim(),
    content: input.content.trim(),
    tags: dedupeTags(input.tags ?? []),
    source: input.source ?? 'user',
    confidence: clamp01(input.confidence ?? (input.source && input.source !== 'user' ? 0.6 : 0.9)),
    status,
    scope: input.scope ?? (input.skillId ? 'skill' : input.projectId ? 'project' : input.workspaceId ? 'workspace' : 'global'),
    sensitivity: input.sensitivity ?? 'normal',
    writePolicy: input.writePolicy ?? 'manual_only',
    pinned: input.pinned ?? false,
    archived: status === 'archived',
    sourceTaskRunId: input.sourceTaskRunId,
    sourceEvidenceId: input.sourceEvidenceId,
    supersedesId: input.supersedesId,
    expiresAt: input.expiresAt,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
  return put(entry);
}

/** Create a memory in the review queue (status = suggested). */
export async function suggestMemory(input: CreateMemoryInput): Promise<MemoryEntry> {
  return createMemory({ ...input, status: 'suggested', source: input.source ?? 'task' });
}

export async function getMemory(id: string): Promise<MemoryEntry | null> {
  const row = await recordBackend().get(COLLECTION, id);
  return row ? toEntry(row) : null;
}

export async function updateMemory(id: string, patch: MemoryPatch): Promise<MemoryEntry | null> {
  const existing = await getMemory(id);
  if (!existing) return null;
  const updated: MemoryEntry = {
    ...existing,
    ...patch,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    tags: patch.tags ? dedupeTags(patch.tags) : existing.tags,
    updatedAt: new Date().toISOString(),
  };
  return put(updated);
}

export async function archiveMemory(id: string): Promise<MemoryEntry | null> {
  return updateMemory(id, { status: 'archived' });
}

export async function deleteMemory(id: string): Promise<void> {
  await recordBackend().delete(COLLECTION, id);
}

// ── Review queue ─────────────────────────────────────────────────────────────

/** Accept a suggested memory (optionally editing it), making it active. */
export async function acceptMemorySuggestion(id: string, patch: MemoryPatch = {}): Promise<MemoryEntry | null> {
  return updateMemory(id, { ...patch, status: 'active' });
}

/** Reject a suggestion. By default keeps it as `rejected` (so it isn't re-suggested). */
export async function rejectMemorySuggestion(id: string, remove = false): Promise<MemoryEntry | null> {
  if (remove) {
    await deleteMemory(id);
    return null;
  }
  return updateMemory(id, { status: 'rejected' });
}

export async function pinMemory(id: string, pinned: boolean): Promise<MemoryEntry | null> {
  return updateMemory(id, { pinned });
}

// ── Memory operations ────────────────────────────────────────────────────────

/**
 * Supersede an older memory with a newer one: the old entry is archived and
 * linked, the new entry records what it supersedes.
 */
export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  await updateMemory(oldId, { status: 'archived' });
  await updateMemory(newId, { supersedesId: oldId });
}

/** Flag two memories as contradictory and move them to needs_review. */
export async function markContradiction(aId: string, bId: string): Promise<void> {
  await updateMemory(aId, { contradictsId: bId, status: 'needs_review' });
  await updateMemory(bId, { contradictsId: aId, status: 'needs_review' });
}

/**
 * Merge several memories into the first (target). Content/tags are combined; the
 * others are archived and linked as superseded by the target.
 */
export async function mergeMemories(targetId: string, otherIds: string[]): Promise<MemoryEntry | null> {
  const target = await getMemory(targetId);
  if (!target) return null;
  const others = (await Promise.all(otherIds.map(getMemory))).filter((m): m is MemoryEntry => !!m);
  const mergedContent = [target.content, ...others.map((o) => o.content)]
    .map((c) => c.trim())
    .filter((c, i, arr) => c && arr.indexOf(c) === i)
    .join('\n');
  const mergedTags = dedupeTags([...target.tags, ...others.flatMap((o) => o.tags)]);
  const confidence = Math.min(1, Math.max(target.confidence, ...others.map((o) => o.confidence)));
  const updated = await updateMemory(targetId, { content: mergedContent, tags: mergedTags, confidence });
  for (const o of others) await updateMemory(o.id, { status: 'archived', supersedesId: targetId });
  return updated;
}

/**
 * Detect likely-duplicate clusters among a user's active memory by token-overlap
 * similarity (Jaccard). Returns groups of 2+ entry ids. Pure-ish — reads store.
 */
export async function detectDuplicates(
  userId: string,
  opts: { workspaceId?: string; threshold?: number } = {},
): Promise<MemoryEntry[][]> {
  const threshold = opts.threshold ?? 0.6;
  const entries = await listMemory({ userId, workspaceId: opts.workspaceId, status: 'active' });
  const groups: MemoryEntry[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    if (used.has(entries[i].id)) continue;
    const group = [entries[i]];
    const aTokens = entrySignature(entries[i]);
    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(entries[j].id)) continue;
      if (jaccard(aTokens, entrySignature(entries[j])) >= threshold) {
        group.push(entries[j]);
        used.add(entries[j].id);
      }
    }
    if (group.length > 1) {
      used.add(entries[i].id);
      groups.push(group);
    }
  }
  return groups;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
  const rows = await recordBackend().all(COLLECTION);
  let entries = rows.map(toEntry).filter((e) => e.userId === query.userId);

  if (query.status) {
    const want = Array.isArray(query.status) ? query.status : [query.status];
    entries = entries.filter((e) => want.includes(e.status));
  } else if (!query.includeArchived) {
    // Default view: hide archived + rejected.
    entries = entries.filter((e) => e.status !== 'archived' && e.status !== 'rejected');
  }

  if (query.workspaceId) {
    entries = entries.filter((e) => !e.workspaceId || e.workspaceId === query.workspaceId);
  }
  if (query.type) entries = entries.filter((e) => e.type === query.type);
  if (query.scope) entries = entries.filter((e) => e.scope === query.scope);
  if (query.tags && query.tags.length) {
    const want = query.tags.map((t) => t.toLowerCase());
    entries = entries.filter((e) => e.tags.some((t) => want.includes(t.toLowerCase())));
  }
  if (query.query) {
    const tokens = tokenize(query.query);
    entries = entries.filter((e) => {
      const hay = `${e.title} ${e.content} ${e.tags.join(' ')}`.toLowerCase();
      return tokens.length === 0 || tokens.some((t) => hay.includes(t));
    });
  }

  return entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function searchMemory(query: string, filters: Omit<MemoryQuery, 'query'>): Promise<MemoryEntry[]> {
  return listMemory({ ...filters, query });
}

/** The review queue: suggested + needs_review entries. */
export async function listSuggestions(userId: string, workspaceId?: string): Promise<MemoryEntry[]> {
  return listMemory({ userId, workspaceId, status: ['suggested', 'needs_review'] });
}

/**
 * Retrieve the most relevant ACTIVE entries for a task. Suggested / archived /
 * rejected / expired memory is never used in prompts.
 */
export async function getRelevantMemory(q: RelevantMemoryQuery): Promise<ScoredMemory[]> {
  const now = Date.now();
  const entries = (await listMemory({ userId: q.userId, workspaceId: q.workspaceId, status: 'active' }))
    .filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now);
  return rankMemories(entries, q.task, { workspaceId: q.workspaceId, limit: q.limit ?? 6 });
}

export async function markMemoryUsed(id: string): Promise<void> {
  const existing = await getMemory(id);
  if (!existing) return;
  await put({ ...existing, lastUsedAt: new Date().toISOString() });
}

// ── Export / import ──────────────────────────────────────────────────────────

export async function exportMemory(userId: string, workspaceId?: string): Promise<string> {
  const entries = await listMemory({ userId, workspaceId, includeArchived: true });
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), entries }, null, 2);
}

/** Import memory JSON produced by exportMemory. Re-keys ids to avoid collisions. */
export async function importMemory(userId: string, json: string): Promise<number> {
  let parsed: { entries?: MemoryEntry[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('invalid_memory_json');
  }
  const entries = parsed.entries ?? [];
  let count = 0;
  for (const e of entries) {
    await createMemory({
      userId,
      workspaceId: e.workspaceId,
      projectId: e.projectId,
      skillId: e.skillId,
      type: e.type,
      title: e.title,
      content: e.content,
      tags: e.tags,
      source: e.source,
      confidence: e.confidence,
      status: e.status === 'rejected' ? 'rejected' : e.status === 'archived' ? 'archived' : e.status,
      scope: e.scope,
      sensitivity: e.sensitivity,
      writePolicy: e.writePolicy,
      pinned: e.pinned,
    });
    count++;
  }
  return count;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function entrySignature(e: MemoryEntry): Set<string> {
  return new Set([...tokenize(e.title), ...tokenize(e.content), ...e.tags.map((t) => t.toLowerCase())]);
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
