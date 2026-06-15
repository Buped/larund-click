import type { AutomationTrigger } from './types';

export function calculateNextRun(trigger: AutomationTrigger, from = new Date()): Date | null {
  if (trigger.kind !== 'schedule') return null;
  if (trigger.intervalMinutes && trigger.intervalMinutes > 0) {
    return new Date(from.getTime() + trigger.intervalMinutes * 60_000);
  }
  if (trigger.cron) return calculateSimpleCronNext(trigger.cron, from);
  return null;
}

export function calculateSimpleCronNext(cron: string, from = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [minuteRaw, hourRaw] = parts;
  const minute = minuteRaw === '*' ? from.getUTCMinutes() : Number(minuteRaw);
  const hour = hourRaw === '*' ? from.getUTCHours() : Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
