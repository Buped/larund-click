// Secret resolution for connections. Secrets are read from (in order):
//   1. an in-memory store set by the settings UI (setSecret),
//   2. Vite env vars (import.meta.env.VITE_<KEY>).
// Secrets must never be written to prompts or the audit log.

const memoryStore = new Map<string, string>();

export function setSecret(key: string, value: string): void {
  if (value) memoryStore.set(key, value);
  else memoryStore.delete(key);
}

export function getSecret(key: string): string | undefined {
  if (memoryStore.has(key)) return memoryStore.get(key);
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
