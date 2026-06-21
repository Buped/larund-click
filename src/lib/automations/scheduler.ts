import { invoke } from '@tauri-apps/api/core';
import { createNotification } from '../notifications/store';
import type { Automation } from './types';
import { calculateNextRun, calculateSimpleCronNext } from './schedule';
import { matchesFolderPattern, triggerFolderWatch } from './triggers';
import {
  createAutomationRun,
  listAutomations,
  recordAutomationRunResult,
  updateAutomation,
} from './store';
import { runAutomation } from './runner';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const folderTimers = new Map<string, ReturnType<typeof setInterval>>();
const folderSnapshots = new Map<string, Map<string, FolderEntry>>();
const DEFAULT_MISSED_THRESHOLD_MINUTES = 15;
const DEFAULT_FOLDER_POLL_MS = 2_500;

interface FolderEntry {
  path: string;
  signature: string;
}

export { calculateNextRun, calculateSimpleCronNext };

export function stopAutomationTimer(automationId: string): void {
  const timer = timers.get(automationId);
  if (timer) clearTimeout(timer);
  timers.delete(automationId);
  const folderTimer = folderTimers.get(automationId);
  if (folderTimer) clearInterval(folderTimer);
  folderTimers.delete(automationId);
  folderSnapshots.delete(automationId);
}

export function stopAllAutomationTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  for (const timer of folderTimers.values()) clearInterval(timer);
  folderTimers.clear();
  folderSnapshots.clear();
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
  if (!automation.enabled || automation.status !== 'active') return;
  if (automation.trigger.kind === 'folder_watch') {
    await startFolderWatchPolling(automation);
    return;
  }
  if (automation.trigger.kind !== 'schedule') return;

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

async function startFolderWatchPolling(automation: Automation): Promise<void> {
  if (automation.trigger.kind !== 'folder_watch' || !automation.trigger.path.trim()) return;
  const pollMs = Math.max(500, automation.trigger.pollIntervalMs ?? DEFAULT_FOLDER_POLL_MS);
  folderSnapshots.set(automation.id, await snapshotFolder(automation));
  folderTimers.set(
    automation.id,
    setInterval(() => {
      void pollFolderWatch(automation).catch(() => undefined);
    }, pollMs),
  );
}

async function pollFolderWatch(automation: Automation): Promise<void> {
  if (automation.trigger.kind !== 'folder_watch') return;
  const previous = folderSnapshots.get(automation.id) ?? new Map<string, FolderEntry>();
  const current = await snapshotFolder(automation);
  folderSnapshots.set(automation.id, current);

  for (const [key, entry] of current) {
    const before = previous.get(key);
    if (!before) {
      await triggerFolderWatch({ userId: automation.userId, path: automation.trigger.path, filePath: entry.path, eventType: 'file_created' });
    } else if (before.signature !== entry.signature) {
      await triggerFolderWatch({ userId: automation.userId, path: automation.trigger.path, filePath: entry.path, eventType: 'file_modified' });
    }
  }
}

async function snapshotFolder(automation: Automation): Promise<Map<string, FolderEntry>> {
  if (automation.trigger.kind !== 'folder_watch') return new Map();
  const entries = await listFolderEntries(automation.trigger.path, Boolean(automation.trigger.includeSubfolders));
  const out = new Map<string, FolderEntry>();
  for (const entry of entries) {
    if (!matchesFolderPattern(entry.path, automation.trigger.pattern)) continue;
    out.set(normalizePath(entry.path), entry);
  }
  return out;
}

async function listFolderEntries(root: string, recursive: boolean): Promise<FolderEntry[]> {
  const listed = await invoke<string[]>('dir_list', { path: root }).catch(() => []);
  const names = Array.isArray(listed) ? listed : [];
  const out: FolderEntry[] = [];
  for (const name of names) {
    const child = joinPath(root, name);
    const mdRaw = await invoke<string>('fs_metadata', { path: child }).catch(() => '');
    const md = parseMetadata(mdRaw);
    if (md.isDir) {
      if (recursive) out.push(...await listFolderEntries(child, recursive));
      continue;
    }
    if (md.isFile !== false) {
      out.push({ path: child, signature: `${md.size ?? 0}:${md.modified_unix ?? 0}` });
    }
  }
  return out;
}

function parseMetadata(raw: string): { isDir?: boolean; isFile?: boolean; size?: number; modified_unix?: number } {
  try {
    const parsed = JSON.parse(raw) as { is_dir?: boolean; is_file?: boolean; size?: number; modified_unix?: number };
    return { isDir: parsed.is_dir, isFile: parsed.is_file, size: parsed.size, modified_unix: parsed.modified_unix };
  } catch {
    return {};
  }
}

function joinPath(root: string, name: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${name}`;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
