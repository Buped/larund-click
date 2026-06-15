import { runAutomation } from './runner';
import { listAutomations } from './store';
import type { Automation } from './types';

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function matchesFolderPattern(filePath: string, pattern?: string): boolean {
  if (!pattern || pattern.trim() === '') return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(filePath.split(/[\\/]/).pop() ?? filePath);
}

export async function triggerConnectionEvent(args: {
  userId: string;
  providerId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<number> {
  const automations = await listAutomations({ userId: args.userId });
  const matching = automations.filter((a) =>
    a.enabled &&
    a.status === 'active' &&
    a.trigger.kind === 'connection_event' &&
    a.trigger.providerId === args.providerId &&
    a.trigger.eventType === args.eventType,
  );
  await Promise.all(matching.map((a) => runAutomation(a.id, args.payload ?? {})));
  return matching.length;
}

export async function triggerFolderWatch(args: {
  userId: string;
  path: string;
  filePath: string;
  debounceMs?: number;
}): Promise<number> {
  const automations = await listAutomations({ userId: args.userId });
  const matching = automations.filter((a) => isMatchingFolderWatch(a, args.path, args.filePath));
  for (const automation of matching) {
    const key = `${automation.id}:${args.filePath}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        void runAutomation(automation.id, {
          kind: 'folder_watch',
          watchedPath: args.path,
          filePath: args.filePath,
        }).catch(() => undefined);
      }, args.debounceMs ?? 750),
    );
  }
  return matching.length;
}

function isMatchingFolderWatch(automation: Automation, watchedPath: string, filePath: string): boolean {
  if (!automation.enabled || automation.status !== 'active' || automation.trigger.kind !== 'folder_watch') return false;
  const configured = normalize(automation.trigger.path);
  const incoming = normalize(watchedPath);
  return configured === incoming && matchesFolderPattern(filePath, automation.trigger.pattern);
}

function normalize(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
