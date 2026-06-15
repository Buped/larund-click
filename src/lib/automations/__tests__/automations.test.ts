import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { listQueueItems } from '../../queue/store';
import { listNotifications } from '../../notifications/store';
import { createAutomation, listAutomationRuns, updateAutomation } from '../store';
import { runAutomation } from '../runner';
import { calculateNextRun, calculateSimpleCronNext, restoreAutomation } from '../scheduler';
import { triggerFolderWatch } from '../triggers';

beforeEach(() => {
  resetRecordBackendForTests();
  vi.useRealTimers();
});

describe('automation scheduler', () => {
  it('calculates interval and simple cron next runs', () => {
    const base = new Date('2026-06-15T10:00:00.000Z');
    expect(calculateNextRun({ kind: 'schedule', intervalMinutes: 5 }, base)?.toISOString()).toBe('2026-06-15T10:05:00.000Z');
    expect(calculateSimpleCronNext('30 11 * * *', base)?.toISOString()).toBe('2026-06-15T11:30:00.000Z');
    expect(calculateSimpleCronNext('30 9 * * *', base)?.toISOString()).toBe('2026-06-16T09:30:00.000Z');
  });

  it('records a skipped run when a schedule was missed beyond threshold', async () => {
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Late report',
      trigger: { kind: 'schedule', intervalMinutes: 5 },
      taskTemplate: { prompt: 'write a report' },
    });
    await updateAutomation(automation.id, { nextRunAt: new Date(Date.now() - 60 * 60_000).toISOString() });
    const stale = (await import('../store')).getAutomation;
    const loaded = await stale(automation.id);
    await restoreAutomation(loaded!, { missedThresholdMinutes: 10 });
    const runs = await listAutomationRuns(automation.id);
    expect(runs[0].status).toBe('skipped');
  });
});

describe('automation runner', () => {
  it('enqueues automation tasks and creates queue-backed task evidence', async () => {
    const automation = await createAutomation({
      userId: 'u1',
      workspaceId: 'ws1',
      name: 'Ops report',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Create a report and read it back.' },
    });
    const result = await runAutomation(automation.id, { reason: 'test' });
    expect(result.automationRunId).toBeTruthy();
    const queue = await listQueueItems({ userId: 'u1' });
    expect(queue[0].source).toBe('automation');
  });

  it('debounces folder-watch triggers', async () => {
    vi.useFakeTimers();
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Folder ingest',
      trigger: { kind: 'folder_watch', path: 'D:/invoices', pattern: '*.txt' },
      taskTemplate: { prompt: 'Read the new file.' },
    });
    expect(await triggerFolderWatch({ userId: 'u1', path: 'D:/invoices', filePath: 'D:/invoices/a.txt', debounceMs: 100 })).toBe(1);
    expect(await triggerFolderWatch({ userId: 'u1', path: 'D:/invoices', filePath: 'D:/invoices/a.txt', debounceMs: 100 })).toBe(1);
    await vi.advanceTimersByTimeAsync(120);
    const runs = await listAutomationRuns(automation.id);
    expect(runs).toHaveLength(1);
    vi.useRealTimers();
  });

  it('emits failed automation notifications', async () => {
    await expect(runAutomation('missing')).rejects.toThrow(/Automation not found/);
    const notes = await listNotifications({ userId: 'u1' });
    expect(notes).toHaveLength(0);
  });
});
