import { invoke } from '@tauri-apps/api/core';

export function makeRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stepDir(runId: string, step: number): string {
  return `~/.larund-click/control-system/${runId}/step-${String(step).padStart(3, '0')}`;
}

export async function writeDebug(path: string, content: string): Promise<void> {
  try {
    await invoke('file_write', { path, content });
  } catch {
    // Debug persistence must never control whether a safe click can proceed.
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeDebug(path, JSON.stringify(value, (_key, val) => typeof val === 'function' ? undefined : val, 2));
}
