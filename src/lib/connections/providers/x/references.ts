export type XReferenceKind = 'x_post' | 'x_user';

export interface XReferenceItem {
  kind: XReferenceKind;
  refId: string;
  label: string;
  detail?: string;
  url: string;
  metadata: Record<string, unknown>;
  userId?: string;
  cachedAt: string;
}

const KEY = 'x_recent_references';
const MAX_ITEMS = 60;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function read(): XReferenceItem[] {
  const raw = storage()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as XReferenceItem[] : [];
  } catch {
    return [];
  }
}

function write(items: XReferenceItem[]): void {
  storage()?.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function rememberXReferences(items: XReferenceItem[]): void {
  if (!items.length) return;
  const current = read();
  const merged = [...items, ...current].filter((item, index, all) =>
    all.findIndex((candidate) => candidate.kind === item.kind && candidate.refId === item.refId && candidate.userId === item.userId) === index,
  );
  write(merged);
}

export function listRecentXReferences(userId?: string): XReferenceItem[] {
  return read()
    .filter((item) => !userId || !item.userId || item.userId === userId)
    .sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
}
