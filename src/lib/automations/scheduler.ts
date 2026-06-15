import { createNotification } from '../notifications/store';
import type { Automation } from './types';
import { calculateNextRun, calculateSimpleCronNext } from './schedule';
import {
  createAutomationRun,
  listAutomations,
  recordAutomationRunResult,
  updateAutomation,
} from './store';
import { runAutomation } from './runner';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEFAULT_MISSED_THRESHOLD_MINUTES = 15;

export { calculateNextRun, calculateSimpleCronNext };

export function stopAutomationTimer(automationId: string): void {
  const timer = timers.get(automationId);
  if (timer) clearTimeout(timer);
  timers.delete(automationId);
}

export function stopAllAutomationTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export async function restoreAutomationScheduler(userId: string, options: {
  missedThresholdMinutes?: number;
} = {}): Promise<void> {
  const automations = await listAutomations({ userId });
  await Promise.all(automations.map((automation) => restoreAutomation(automation, options)));
}

export async function restoreAutomation(automation: Automation, options: {
  missedThresholdMinutes?: number;
} = {}): Promise<void> {
  stopAutomationTimer(automation.id);
  if (!automation.enabled || automation.status !== 'active' || automation.trigger.kind !== 'schedule') return;

  const threshold = (options.missedThresholdMinutes ?? DEFAULT_MISSED_THRESHOLD_MINUTES) * 60_000;
  const now = new Date();
  const dueAt = automation.nextRunAt ? new Date(automation.nextRunAt) : calculateNextRun(automation.trigger, now);
  if (!dueAt) return;

  if (dueAt.getTime() <= now.getTime()) {
    const missedBy = now.getTime() - dueAt.getTime();
    if (missedBy <= threshold) {
      await runAutomation(automation.id, { reason: 'missed_schedule', dueAt: dueAt.toISOString() });
    } else {
      await createAutomationRun({
        automationId: automation.id,
        status: 'skipped',
        triggerPayload: { reason: 'missed_threshold_exceeded', dueAt: dueAt.toISOString(), missedByMs: missedBy },
      });
      await recordAutomationRunResult(automation.id, 'skipped');
    }
    const fresh = await updateAutomation(automation.id, {
      nextRunAt: calculateNextRun(automation.trigger, now)?.toISOString(),
    });
    if (fresh) await restoreAutomation(fresh, options);
    return;
  }

  const delay = Math.max(1_000, dueAt.getTime() - now.getTime());
  timers.set(
    automation.id,
    setTimeout(async () => {
      try {
        await runAutomation(automation.id, { reason: 'schedule', dueAt: dueAt.toISOString() });
      } catch (err) {
        await createNotification({
          userId: automation.userId,
          workspaceId: automation.workspaceId,
          kind: 'automation_failed',
          title: `Automation failed: ${automation.name}`,
          body: err instanceof Error ? err.message : String(err),
          metadata: { automationId: automation.id },
        });
      } finally {
        const fresh = await updateAutomation(automation.id, {
          nextRunAt: calculateNextRun(automation.trigger, new Date())?.toISOString(),
        });
        if (fresh) await restoreAutomation(fresh, options);
      }
    }, delay),
  );
}
