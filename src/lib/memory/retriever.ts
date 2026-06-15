// Memory retrieval — Phase 1 uses deterministic lexical scoring (no vector DB).
// The interface (`scoreMemory`, `rankMemories`) is intentionally simple so a
// vector/embedding backend can be slotted in behind it later without changing
// callers.

import type { MemoryEntry, MemoryType, ScoredMemory } from './types';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you',
  'have', 'has', 'are', 'was', 'will', 'a', 'an', 'of', 'to', 'in', 'on', 'is',
  'it', 'be', 'or', 'as', 'at', 'by',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9áéíóöőúüű]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Type relevance: which memory types matter most for a given task wording. */
function typeRelevance(type: MemoryType, taskTokens: Set<string>): number {
  // Preferences, corrections and procedural knowledge are broadly useful; bias
  // toward them slightly so durable guidance surfaces even on weak lexical match.
  const base: Record<MemoryType, number> = {
    correction: 2.0,
    preference: 1.5,
    procedural: 1.2,
    user_profile: 1.0,
    workspace: 1.0,
    project: 1.0,
    evidence: 0.6,
    episodic: 0.5,
  };
  let score = base[type] ?? 0.5;
  if (type === 'procedural' && (taskTokens.has('how') || taskTokens.has('steps') || taskTokens.has('workflow'))) {
    score += 0.5;
  }
  return score;
}

function recencyBoost(entry: MemoryEntry, now: number): number {
  const ref = entry.lastUsedAt ?? entry.updatedAt ?? entry.createdAt;
  const ageMs = now - new Date(ref).getTime();
  const ageDays = ageMs / 86_400_000;
  if (ageDays <= 1) return 1.0;
  if (ageDays <= 7) return 0.6;
  if (ageDays <= 30) return 0.3;
  return 0.1;
}

export interface ScoreOptions {
  workspaceId?: string;
  now?: number;
}

/**
 * Score one memory entry against a task. Deterministic and side-effect-free.
 * Components: tag match, title match, content match, workspace match, pinned
 * boost, recency boost, type relevance.
 */
export function scoreMemory(entry: MemoryEntry, task: string, opts: ScoreOptions = {}): number {
  // Only active memory is ever scored for the prompt. (status may be absent on
  // legacy rows; archived flag is the back-compat signal.)
  if (entry.archived || (entry.status && entry.status !== 'active')) return 0;
  const now = opts.now ?? Date.now();
  const taskTokens = new Set(tokenize(task));
  if (taskTokens.size === 0 && !entry.pinned) return 0;

  let score = 0;

  // Exact tag matches are the strongest signal.
  for (const tag of entry.tags) {
    if (taskTokens.has(tag.toLowerCase())) score += 4;
  }

  // Title overlap (weighted higher than body).
  const titleTokens = new Set(tokenize(entry.title));
  for (const t of titleTokens) if (taskTokens.has(t)) score += 2;

  // Content overlap.
  const contentTokens = new Set(tokenize(entry.content));
  for (const t of contentTokens) if (taskTokens.has(t)) score += 1;

  // Workspace match: same-workspace memory is more relevant; user-global
  // (no workspace) memory still applies everywhere.
  if (opts.workspaceId && entry.workspaceId === opts.workspaceId) score += 2;
  else if (entry.workspaceId && opts.workspaceId && entry.workspaceId !== opts.workspaceId) score -= 1;

  if (entry.pinned) score += 3;
  score += recencyBoost(entry, now);
  score *= typeRelevance(entry.type, taskTokens) >= 1 ? 1 : 1; // keep deterministic
  score += typeRelevance(entry.type, taskTokens);

  // Confidence scales the whole thing down for low-trust auto-extracted memory.
  score *= 0.5 + 0.5 * clamp01(entry.confidence);

  return Math.max(0, round2(score));
}

/** Rank a set of entries; returns scored entries with score > 0, best first. */
export function rankMemories(
  entries: MemoryEntry[],
  task: string,
  opts: ScoreOptions & { limit?: number } = {},
): ScoredMemory[] {
  const scored = entries
    .map((entry) => ({ entry, score: scoreMemory(entry, task, opts) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  return typeof opts.limit === 'number' ? scored.slice(0, opts.limit) : scored;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
