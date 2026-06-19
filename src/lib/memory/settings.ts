// Memory behaviour settings — the user's control over how aggressively Larund
// remembers. Stored as columns on the single-row `settings` table (see
// database.ts). `parseMemorySettings` is pure so it is unit-testable; the async
// getter wraps the DB read and never throws (falls back to safe defaults).

import { getSettings } from '../database';

export interface MemorySettings {
  /** Master switch. When off, no extraction, retrieval-write, or summaries. */
  enabled: boolean;
  /** Surface suggested memories from chats/tasks for review. */
  suggestions: boolean;
  /** Auto-save low-risk facts (preferences/procedural) without review. */
  autoSaveLowRisk: boolean;
  /** Generate an end-of-day episodic summary. */
  dailySummary: boolean;
  /** HH:MM local time the daily summary should run. */
  dailySummaryTime: string;
  /** Always suggest (never auto-save) client/business data. */
  askBeforeClientData: boolean;
  /** Episodic memory older than this many days may be pruned (0 = keep forever). */
  episodicRetentionDays: number;
}

export function defaultMemorySettings(): MemorySettings {
  return {
    enabled: true,
    suggestions: true,
    autoSaveLowRisk: false,
    dailySummary: true,
    dailySummaryTime: '22:00',
    askBeforeClientData: true,
    episodicRetentionDays: 30,
  };
}

/** Coerce a raw settings row (0/1 ints, strings) into typed MemorySettings. */
export function parseMemorySettings(row: Record<string, unknown> | null | undefined): MemorySettings {
  const d = defaultMemorySettings();
  if (!row) return d;
  const bool = (v: unknown, fallback: boolean) =>
    v === undefined || v === null ? fallback : v === 1 || v === true || v === '1';
  const time = typeof row.memory_daily_summary_time === 'string' && /^\d{1,2}:\d{2}$/.test(row.memory_daily_summary_time)
    ? row.memory_daily_summary_time
    : d.dailySummaryTime;
  const retention = Number(row.memory_episodic_retention_days);
  return {
    enabled: bool(row.memory_enabled, d.enabled),
    suggestions: bool(row.memory_suggestions, d.suggestions),
    autoSaveLowRisk: bool(row.memory_auto_save, d.autoSaveLowRisk),
    dailySummary: bool(row.memory_daily_summary, d.dailySummary),
    dailySummaryTime: time,
    askBeforeClientData: bool(row.memory_ask_client_data, d.askBeforeClientData),
    episodicRetentionDays: Number.isFinite(retention) && retention >= 0 ? retention : d.episodicRetentionDays,
  };
}

export async function getMemorySettings(): Promise<MemorySettings> {
  try {
    const row = await getSettings();
    return parseMemorySettings(row);
  } catch {
    return defaultMemorySettings();
  }
}
