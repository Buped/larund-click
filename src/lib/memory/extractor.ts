// Memory extraction — conservative, deterministic candidate detection. After a
// task, we MAY surface a small number of memory candidates for the user to keep.
// We deliberately do NOT auto-save aggressively; every candidate carries a
// `reviewStatus` so the UI can require confirmation before it becomes real.

import type { CreateMemoryInput, MemoryType } from './types';

export interface MemoryCandidate {
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  reviewStatus: 'pending';
  rationale: string;
}

export interface ExtractionContext {
  userId: string;
  workspaceId?: string;
  /** The user's most recent message(s) in the task. */
  userText: string;
  /** Whether the task completed with verified evidence. */
  verified?: boolean;
  /** Whether the run involved repeated structured steps (a workflow pattern). */
  repeatedStructuredSteps?: boolean;
  /** A short outcome summary, if available. */
  summary?: string;
}

const PREFERENCE_PATTERNS = [
  /\bi (?:always|usually|prefer|like to|want you to|tend to)\b/i,
  /\bplease always\b/i,
  /\bfrom now on\b/i,
  /\bmindig\b/i, // hu: "always"
  /\bszeretném, hogy\b/i, // hu: "I'd like you to"
];

const CORRECTION_PATTERNS = [
  /\bno,? that(?:'s| is) wrong\b/i,
  /\bthat(?:'s| is) (?:not|incorrect)\b/i,
  /\byou (?:didn't|did not|forgot|missed)\b/i,
  /\bnem,? (?:ez|az)?\s*(?:rossz|nem jó|üres|hibás)\b/i, // hu corrections
];

/**
 * Extract conservative memory candidates from a finished task. Returns at most a
 * handful; empty array is the common case.
 */
export function extractMemoryCandidates(ctx: ExtractionContext): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  const text = ctx.userText.trim();

  if (text && PREFERENCE_PATTERNS.some((re) => re.test(text))) {
    out.push({
      type: 'preference',
      title: firstClause(text),
      content: text,
      tags: keywords(text),
      confidence: 0.7,
      reviewStatus: 'pending',
      rationale: 'User stated a standing preference.',
    });
  }

  if (text && CORRECTION_PATTERNS.some((re) => re.test(text))) {
    out.push({
      type: 'correction',
      title: `Correction: ${firstClause(text)}`,
      content: text,
      tags: keywords(text),
      confidence: 0.7,
      reviewStatus: 'pending',
      rationale: 'User corrected the agent; remember to avoid repeating the mistake.',
    });
  }

  if (ctx.repeatedStructuredSteps && ctx.summary) {
    out.push({
      type: 'procedural',
      title: `Workflow: ${firstClause(ctx.summary)}`,
      content: ctx.summary,
      tags: keywords(ctx.summary),
      confidence: 0.5,
      reviewStatus: 'pending',
      rationale: 'Task involved a repeatable structured procedure.',
    });
  }

  if (ctx.verified && ctx.summary) {
    out.push({
      type: 'evidence',
      title: `Verified outcome: ${firstClause(ctx.summary)}`,
      content: ctx.summary,
      tags: keywords(ctx.summary),
      confidence: 0.6,
      reviewStatus: 'pending',
      rationale: 'Outcome was verified by evidence; useful as a factual record.',
    });
  }

  return out;
}

/** Convert an approved candidate into a CreateMemoryInput. */
export function candidateToInput(
  candidate: MemoryCandidate,
  userId: string,
  workspaceId?: string,
): CreateMemoryInput {
  return {
    userId,
    workspaceId,
    type: candidate.type,
    title: candidate.title,
    content: candidate.content,
    tags: candidate.tags,
    source: candidate.type === 'correction' ? 'correction' : 'task',
    confidence: candidate.confidence,
  };
}

function firstClause(text: string): string {
  const clause = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  return clause.length > 80 ? `${clause.slice(0, 77)}…` : clause;
}

function keywords(text: string): string[] {
  const stop = new Set(['always', 'please', 'from', 'that', 'this', 'with', 'your', 'mindig']);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9áéíóöőúüű]+/i)
    .filter((w) => w.length >= 4 && !stop.has(w));
  return [...new Set(words)].slice(0, 5);
}
