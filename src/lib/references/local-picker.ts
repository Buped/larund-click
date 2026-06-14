import type { DocumentReference } from './types';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function labelFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function referenceFromPath(path: string, kind: 'file' | 'folder'): DocumentReference {
  return {
    id: id(kind),
    kind,
    label: labelFromPath(path),
    path,
    source: 'user_reference',
  };
}

export function referenceFromUrl(url: string): DocumentReference {
  return {
    id: id('url'),
    kind: 'url',
    label: url.replace(/^https?:\/\//, '').slice(0, 64),
    url,
    source: 'user_reference',
  };
}

async function tryDialogOpen(directory: boolean, multiple: boolean): Promise<string[] | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
      open?: (options: { directory?: boolean; multiple?: boolean }) => Promise<string | string[] | null>;
    }>;
    const mod = await dynamicImport('@tauri-apps/plugin-dialog');
    if (!mod.open) return null;
    const selected = await mod.open({ directory, multiple });
    if (!selected) return null;
    return Array.isArray(selected) ? selected.map(String) : [String(selected)];
  } catch {
    return null;
  }
}

export async function pickLocalFile(): Promise<DocumentReference[]> {
  const paths = await tryDialogOpen(false, true);
  const selected = paths ?? promptPaths('Paste file path(s), one per line');
  return selected.map((path) => referenceFromPath(path, 'file'));
}

export async function pickLocalFolder(): Promise<DocumentReference[]> {
  const paths = await tryDialogOpen(true, false);
  const selected = paths ?? promptPaths('Paste folder path');
  return selected.map((path) => referenceFromPath(path, 'folder'));
}

export async function pickUrlReference(): Promise<DocumentReference[]> {
  const value = window.prompt('Paste URL');
  return value?.trim() ? [referenceFromUrl(value.trim())] : [];
}

function promptPaths(message: string): string[] {
  const value = window.prompt(message);
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
