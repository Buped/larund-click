// Memory extraction — conservative, deterministic candidate detection. After a
// chat turn or task, we MAY surface a small number of memory candidates. We
// deliberately do NOT auto-save aggressively; the write-policy decision (below)
// decides which candidates may auto-save vs. need review, honoring the user's
// MemorySettings. Secrets are NEVER stored as content.

import type { CreateMemoryInput, MemoryType, MemoryScope, MemorySensitivity } from './types';
import type { MemorySettings } from './settings';

export interface MemoryCandidate {
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  reviewStatus: 'pending';
  rationale: string;
  scope?: MemoryScope;
  sensitivity?: MemorySensitivity;
  clientId?: string;
  /** True when the user explicitly asked Larund to remember this. */
  explicit?: boolean;
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

// "Call me Buped." / "My name is …" / "hívj …" → a stable user_profile fact.
const PREFERRED_NAME = /\b(?:call me|my name is|i'm called|hívj(?:ál)?(?: engem)?|a nevem)\s+([\p{L}][\p{L}\-' ]{1,40})/iu;

// Explicit "remember this" request → should be kept, not just noted.
const REMEMBER_THIS = /\b(remember (?:this|that|to)|please remember|note that|keep in mind|jegyezd meg|emlékezz(?: arra)?|ezt jegyezd)\b/i;

// "For Kovács Dental, (always )?use a professional but friendly tone."
const CLIENT_TONE = /\bfor ([\p{L}][\p{L}\-&. ]{1,40}?),?\s+(?:always )?use (?:an?|the)?\s*([\p{L} ,]+?)\s+tone\b/iu;

// Apparent secret values — never store the value; record existence only.
const SECRET_VALUE = [
  /\bsk_(?:live|test)_[a-z0-9]{8,}/i,        // Stripe
  /\bAKIA[0-9A-Z]{12,}/,                       // AWS access key
  /\bghp_[a-z0-9]{20,}/i,                      // GitHub PAT
  /\bAIza[0-9A-Za-z\-_]{20,}/,                 // Google API key
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/,            // Slack token
  /\b[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b/, // JWT-ish
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_VALUE.some((re) => re.test(text));
}

/**
 * Extract conservative memory candidates from a chat turn or finished task.
 * Returns at most a handful; empty array is the common case.
 */
export function extractMemoryCandidates(ctx: ExtractionContext): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  const text = ctx.userText.trim();

  // 0. Secret guard. If the message contains an apparent secret value, do NOT
  // store its content anywhere — record only that it exists, as a reference.
  if (text && looksLikeSecret(text)) {
    out.push({
      type: 'sensitive_reference',
      title: 'Sensitive credential mentioned',
      content: 'The user referenced a secret/credential in chat. Stored as a reference only; the value is NOT kept in memory. Use the secure store/connection instead.',
      tags: ['secret', 'credential'],
      confidence: 0.6,
      reviewStatus: 'pending',
      sensitivity: 'secret_reference',
      rationale: 'A secret value appeared in chat; recorded as a reference without the value.',
    });
    // Fall through: other patterns still run, but the secret guard below strips
    // any candidate that would embed the secret value.
  }

  const nameMatch = text.match(PREFERRED_NAME);
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/\s+/g, ' ');
    out.push({
      type: 'user_profile',
      title: 'Preferred name',
      content: `User prefers to be called ${name}.`,
      tags: ['name', 'profile'],
      confidence: 0.85,
      reviewStatus: 'pending',
      scope: 'global',
      explicit: true,
      rationale: 'User stated how they want to be addressed.',
    });
  }

  const clientMatch = text.match(CLIENT_TONE);
  if (clientMatch) {
    const client = clientMatch[1].trim().replace(/\s+/g, ' ');
    const tone = clientMatch[2].trim().replace(/\s+/g, ' ');
    out.push({
      type: 'client_profile',
      title: `${client} — tone`,
      content: `For ${client}, use a ${tone} tone.`,
      tags: [...keywords(client), 'tone'],
      confidence: 0.7,
      reviewStatus: 'pending',
      scope: ctx.workspaceId ? 'workspace' : 'global',
      clientId: slug(client),
      rationale: 'User specified communication tone for a client.',
    });
  }

  if (text && PREFERENCE_PATTERNS.some((re) => re.test(text))) {
    out.push({
      type: 'preference',
      title: firstClause(text),
      content: text,
      tags: keywords(text),
      confidence: 0.7,
      reviewStatus: 'pending',
      explicit: REMEMBER_THIS.test(text),
      rationale: 'User stated a standing preference.',
    });
  }

  // Bare "remember this …" that didn't match a more specific pattern above.
  if (text && REMEMBER_THIS.test(text) && !out.some((c) => c.explicit)) {
    out.push({
      type: 'preference',
      title: firstClause(text.replace(REMEMBER_THIS, '').trim()) || firstClause(text),
      content: text,
      tags: keywords(text),
      confidence: 0.8,
      reviewStatus: 'pending',
      explicit: true,
      rationale: 'User explicitly asked Larund to remember this.',
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

  // Final secret scrub: never let a non-reference candidate carry a secret value.
  return out.filter((c) => c.type === 'sensitive_reference' || !looksLikeSecret(c.content));
}

export interface WriteDecision {
  /** Candidates safe to auto-save as active memory right now. */
  autoSave: MemoryCandidate[];
  /** Candidates that must be reviewed (suggested). */
  suggest: MemoryCandidate[];
}

/**
 * Decide which candidates auto-save vs. need review, per the user's settings.
 * Rules: corrections, client_profile, sensitive_reference and project facts
 * ALWAYS go to review. Explicit "remember this" requests and low-risk
 * preferences/procedural may auto-save when auto-save is enabled.
 */
export function decideMemoryWrites(candidates: MemoryCandidate[], settings: MemorySettings): WriteDecision {
  const autoSave: MemoryCandidate[] = [];
  const suggest: MemoryCandidate[] = [];
  if (!settings.enabled) return { autoSave, suggest };

  for (const c of candidates) {
    const mustReview =
      c.type === 'correction' ||
      c.type === 'sensitive_reference' ||
      c.type === 'project' ||
      (c.type === 'client_profile' && settings.askBeforeClientData);
    const lowRisk = c.type === 'preference' || c.type === 'procedural' || c.type === 'user_profile';

    if (!mustReview && (c.explicit || (settings.autoSaveLowRisk && lowRisk))) {
      autoSave.push(c);
    } else if (settings.suggestions || c.explicit) {
      suggest.push(c);
    }
  }
  return { autoSave, suggest };
}

/** Convert an approved candidate into a CreateMemoryInput. */
export function candidateToInput(
  candidate: MemoryCandidate,
  userId: string,
  workspaceId?: string,
): CreateMemoryInput {
  return {
    userId,
    workspaceId: candidate.scope === 'workspace' ? workspaceId : workspaceId,
    clientId: candidate.clientId,
    type: candidate.type,
    title: candidate.title,
    content: candidate.content,
    tags: candidate.tags,
    source: candidate.type === 'correction' ? 'correction' : 'agent',
    confidence: candidate.confidence,
    scope: candidate.scope,
    sensitivity: candidate.sensitivity,
    metadata: { rationale: candidate.rationale, explicit: candidate.explicit ?? false },
  };
}

function firstClause(text: string): string {
  const clause = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  return clause.length > 80 ? `${clause.slice(0, 77)}…` : clause;
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function keywords(text: string): string[] {
  const stop = new Set(['always', 'please', 'from', 'that', 'this', 'with', 'your', 'mindig', 'tone']);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9áéíóöőúüű]+/i)
    .filter((w) => w.length >= 4 && !stop.has(w));
  return [...new Set(words)].slice(0, 5);
}
