// Secret resolution for connections. Secrets are read from (in order):
//   1. an in-memory store set by the settings UI (setSecret),
//   2. Vite env vars (import.meta.env.VITE_<KEY>).
// Secrets must never be written to prompts or the audit log.

const memoryStore = new Map<string, string>();

export function setSecret(key: string, value: string): void {
  if (value) memoryStore.set(key, value);
  else memoryStore.delete(key);
}

async function loadStore(): Promise<{ get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; delete: (key: string) => Promise<void>; save: () => Promise<void> } | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
      Store?: { load: (path: string) => Promise<{ get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; delete: (key: string) => Promise<void>; save: () => Promise<void> }> };
    }>;
    const mod = await dynamicImport('@tauri-apps/plugin-store');
    return mod.Store ? mod.Store.load('connections.dat') : null;
  } catch {
    return null;
  }
}

export async function setPersistentSecret(key: string, value: string): Promise<void> {
  setSecret(key, value);
  const store = await loadStore();
  if (store) {
    if (value) await store.set(key, value);
    else await store.delete(key);
    await store.save();
    return;
  }
  if (value) localStorage.setItem(`connection_secret:${key}`, value);
  else localStorage.removeItem(`connection_secret:${key}`);
}

export async function loadPersistentSecret(key: string): Promise<string | undefined> {
  const store = await loadStore();
  if (store) {
    const value = await store.get(key);
    if (typeof value === 'string' && value) {
      setSecret(key, value);
      return value;
    }
  }
  const fallback = localStorage.getItem(`connection_secret:${key}`) || undefined;
  if (fallback) setSecret(key, fallback);
  return fallback;
}

export function getSecret(key: string): string | undefined {
  if (memoryStore.has(key)) return memoryStore.get(key);
  try {
    const persisted = localStorage.getItem(`connection_secret:${key}`);
    if (persisted) {
      memoryStore.set(key, persisted);
      return persisted;
    }
  } catch {}
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.[`VITE_${key}`];
}

export function getSecrets(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = getSecret(k);
    if (v) out[k] = v;
  }
  return out;
}

export function hasAllSecrets(keys: string[]): boolean {
  return keys.length === 0 || keys.every((k) => Boolean(getSecret(k)));
}
