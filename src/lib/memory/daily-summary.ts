// End-of-day memory. Once a day Larund compresses the day's chats, task runs,
// corrections and new facts into ONE episodic memory ("Daily summary — DATE").
// The content build is pure/deterministic (no LLM, no cost, fully testable); the
// gather + persist + schedule wrappers are best-effort and never throw.

import { getSessions, getMessages } from '../database';
import { listTaskRuns } from '../tasks/store';
import { listMemory, createMemory } from './store';
import { getMemorySettings, type MemorySettings } from './settings';
import type { MemoryEntry } from './types';

export interface DailySources {
  date: string; // YYYY-MM-DD
  chats: { title: string; userMessages: string[] }[];
  completedTasks: { title: string; summary?: string; outputs: string[] }[];
  openTasks: string[];
  corrections: string[];
  newFacts: string[];
}

/** Local YYYY-MM-DD for a Date (not UTC) so "today" matches the user's clock. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** A stored timestamp (ISO or "YYYY-MM-DD HH:MM:SS") falls on `date`? */
function onDate(ts: string | undefined, date: string): boolean {
  if (!ts) return false;
  return ts.slice(0, 10) === date;
}

/** Build the markdown body of a daily summary. Pure + deterministic. */
export function buildDailySummaryContent(s: DailySources): string {
  const section = (title: string, lines: string[]): string =>
    `### ${title}\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- —'}`;

  const worked: string[] = [];
  for (const c of s.chats) {
    const first = c.userMessages[0];
    worked.push(first ? `${c.title}: ${clip(first, 90)}` : c.title);
  }
  for (const t of s.completedTasks) worked.push(`Task: ${t.title}`);

  const decisions = s.completedTasks
    .filter((t) => t.summary)
    .map((t) => `${t.title} — ${clip(t.summary!, 120)}`);

  const followUps = [...s.openTasks];

  return [
    section('What we worked on', dedupe(worked).slice(0, 12)),
    section('Important decisions', dedupe(decisions).slice(0, 8)),
    section('New client/project facts', dedupe(s.newFacts).slice(0, 8)),
    section('Open tasks', dedupe(s.openTasks).slice(0, 8)),
    section('Corrections/preferences learned', dedupe(s.corrections).slice(0, 8)),
    section('Follow-ups for tomorrow', dedupe(followUps).slice(0, 8)),
  ].join('\n\n');
}

/** Gather the day's sources from local stores. Best-effort; never throws. */
export async function gatherDailySources(userId: string, date: string, workspaceId?: string): Promise<DailySources> {
  const sources: DailySources = { date, chats: [], completedTasks: [], openTasks: [], corrections: [], newFacts: [] };

  try {
    const sessions = await getSessions(workspaceId);
    for (const sess of sessions) {
      if (!onDate(sess.updated_at, date) && !onDate(sess.created_at, date)) continue;
      const msgs = await getMessages(sess.id).catch(() => []);
      const userMessages = msgs
        .filter((m: any) => m.role === 'user' && onDate(m.created_at, date) && m.content)
        .map((m: any) => String(m.content));
      if (userMessages.length) sources.chats.push({ title: sess.title || 'Chat', userMessages });
    }
  } catch { /* chats are optional */ }

  try {
    const runs = await listTaskRuns({ userId, workspaceId });
    for (const r of runs) {
      const onThisDay = onDate(r.completedAt, date) || onDate(r.startedAt, date) || onDate(r.updatedAt, date);
      if (!onThisDay) continue;
      if (r.status === 'completed') {
        sources.completedTasks.push({ title: r.title, summary: r.summary, outputs: r.outputRefs.map((o) => o.label) });
      } else if (r.status !== 'cancelled') {
        sources.openTasks.push(`${r.title} (${r.status})`);
      }
    }
  } catch { /* tasks are optional */ }

  try {
    const mems = await listMemory({ userId, workspaceId, includeArchived: false });
    for (const m of mems) {
      if (!onDate(m.createdAt, date)) continue;
      if (m.type === 'correction' || m.type === 'preference') sources.corrections.push(m.title);
      if (m.type === 'client_profile' || m.type === 'project') sources.newFacts.push(m.title);
    }
  } catch { /* memory facts optional */ }

  return sources;
}

/** Has a daily summary already been generated for this date? */
export async function dailySummaryExists(userId: string, date: string, workspaceId?: string): Promise<boolean> {
  const mems = await listMemory({ userId, workspaceId, type: 'episodic', status: ['active', 'suggested'] }).catch(() => []);
  return mems.some((m) => (m.metadata as { summaryDate?: string } | undefined)?.summaryDate === date);
}

export interface GenerateDailySummaryResult {
  created: boolean;
  entry?: MemoryEntry;
  reason?: string;
}

/**
 * Generate (and persist) the daily summary for `date`. Idempotent: returns
 * { created:false } if one already exists or there's nothing to summarize.
 * Status is 'suggested' by default; 'active' when auto-save is enabled.
 */
export async function generateDailySummary(
  userId: string,
  date: string = localDateKey(),
  opts: { workspaceId?: string; settings?: MemorySettings; force?: boolean } = {},
): Promise<GenerateDailySummaryResult> {
  const settings = opts.settings ?? (await getMemorySettings());
  if (!settings.enabled) return { created: false, reason: 'memory_disabled' };
  if (!opts.force && (await dailySummaryExists(userId, date, opts.workspaceId))) {
    return { created: false, reason: 'already_exists' };
  }

  const sources = await gatherDailySources(userId, date, opts.workspaceId);
  const hasContent = sources.chats.length || sources.completedTasks.length || sources.openTasks.length || sources.corrections.length || sources.newFacts.length;
  if (!hasContent && !opts.force) return { created: false, reason: 'nothing_to_summarize' };

  const entry = await createMemory({
    userId,
    workspaceId: opts.workspaceId,
    type: 'episodic',
    title: `Daily summary — ${date}`,
    content: buildDailySummaryContent(sources),
    tags: ['daily-summary', date],
    source: 'system',
    confidence: 0.6,
    status: settings.autoSaveLowRisk ? 'active' : 'suggested',
    scope: opts.workspaceId ? 'workspace' : 'global',
    writePolicy: settings.autoSaveLowRisk ? 'auto_low_risk' : 'suggest_then_confirm',
    metadata: { summaryDate: date, kind: 'daily_summary' },
  });
  return { created: true, entry };
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/** Parse "HH:MM" to minutes-since-midnight; -1 if malformed. */
function timeToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Pure scheduling decision: is a daily summary due now? Due when the feature is
 * on, the local clock has passed the configured time, and we haven't already run
 * today (lastRunDate !== today).
 */
export function dueForDailySummary(
  now: Date,
  settings: MemorySettings,
  lastRunDate?: string,
): { due: boolean; date: string } {
  const date = localDateKey(now);
  if (!settings.enabled || !settings.dailySummary) return { due: false, date };
  if (lastRunDate === date) return { due: false, date };
  const target = timeToMinutes(settings.dailySummaryTime);
  if (target < 0) return { due: false, date };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return { due: nowMin >= target, date };
}

const LAST_RUN_KEY = 'memory_daily_summary_last_run';

/**
 * Start a lightweight local scheduler that checks every 15 minutes whether the
 * daily summary is due, and generates it. Runs only while the desktop app is
 * open. Best-effort; returns a stop function.
 */
export function restoreDailySummaryScheduler(userId: string): () => void {
  const check = async () => {
    try {
      const settings = await getMemorySettings();
      const last = (() => { try { return localStorage.getItem(LAST_RUN_KEY) ?? undefined; } catch { return undefined; } })();
      const { due, date } = dueForDailySummary(new Date(), settings, last);
      if (!due) return;
      const res = await generateDailySummary(userId, date, { settings });
      // Mark the day as handled whether we created one or found nothing — avoids
      // re-checking all evening once the time has passed.
      if (res.created || res.reason === 'already_exists' || res.reason === 'nothing_to_summarize') {
        try { localStorage.setItem(LAST_RUN_KEY, date); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('Daily summary check failed:', err);
    }
  };
  void check();
  const handle = globalThis.setInterval(check, 15 * 60 * 1000);
  return () => globalThis.clearInterval(handle);
}

function clip(s: string, n: number): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim();
    if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); }
  }
  return out;
}
