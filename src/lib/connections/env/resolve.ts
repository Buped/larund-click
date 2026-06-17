import type { CatalogStatus } from '../catalog/types';
import { getSecret, isPlaceholderSecret } from '../secrets';
import { envSchemaForProvider } from './schema';

export type ProviderSetupStatus =
  | 'connected'
  | 'needs_setup'
  | 'invalid_auth'
  | 'insufficient_scope'
  | 'mcp_available'
  | 'coming_soon';

export type ProviderSecretSource = 'secret_store' | 'runtime_env' | 'dotenv' | 'missing';

let dotenvCache: Record<string, string> | null = null;

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function readDotEnv(): Record<string, string> {
  if (dotenvCache) return dotenvCache;
  dotenvCache = {};
  try {
    const getBuiltin = (globalThis as unknown as {
      process?: { cwd?: () => string; getBuiltinModule?: (name: string) => { existsSync?: (path: string) => boolean; readFileSync?: (path: string, enc: string) => string } };
    }).process?.getBuiltinModule;
    const fs = getBuiltin?.('fs');
    const pathMod = getBuiltin?.('path') as unknown as { join?: (...parts: string[]) => string } | undefined;
    const cwd = (globalThis as unknown as { process?: { cwd?: () => string } }).process?.cwd?.();
    const path = cwd && pathMod?.join ? pathMod.join(cwd, '.env') : '.env';
    if (fs?.existsSync?.(path) && fs.readFileSync) dotenvCache = parseEnv(fs.readFileSync(path, 'utf8'));
  } catch {
    dotenvCache = {};
  }
  return dotenvCache;
}

function processOrViteEnv(key: string): string | undefined {
  try {
    const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const viteValue = viteEnv?.[key] ?? viteEnv?.[`VITE_${key}`];
    if (viteValue && !isPlaceholderSecret(viteValue)) return viteValue;
  } catch {}
  try {
    const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const value = env?.[key] ?? env?.[`VITE_${key}`];
    if (value && !isPlaceholderSecret(value)) return value;
  } catch {}
  return undefined;
}

export function getProviderSecret(_providerId: string, key: string): string | undefined {
  const storedOrRuntime = getSecret(key);
  if (storedOrRuntime && !isPlaceholderSecret(storedOrRuntime)) return storedOrRuntime;
  const runtime = processOrViteEnv(key);
  if (runtime) return runtime;
  const dotenv = readDotEnv()[key];
  return dotenv && !isPlaceholderSecret(dotenv) ? dotenv : undefined;
}

export function getProviderSecretSource(_providerId: string, key: string): ProviderSecretSource {
  const storedOrRuntime = getSecret(key);
  if (storedOrRuntime && !isPlaceholderSecret(storedOrRuntime)) return 'secret_store';
  if (processOrViteEnv(key)) return 'runtime_env';
  const dotenv = readDotEnv()[key];
  if (dotenv && !isPlaceholderSecret(dotenv)) return 'dotenv';
  return 'missing';
}

export function getProviderEnv(providerId: string): Record<string, string> {
  const schema = envSchemaForProvider(providerId);
  const keys = [...new Set([...schema.appRequired, ...schema.appOptional, ...schema.devShortcut])];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = getProviderSecret(providerId, key);
    if (value) out[key] = value;
  }
  return out;
}

/** App-level developer credentials missing for this provider (never user tokens). */
export function getMissingAppCredentials(providerId: string): string[] {
  const schema = envSchemaForProvider(providerId);
  return schema.appRequired.filter((key) => !getProviderSecret(providerId, key));
}

/** @deprecated use getMissingAppCredentials — app-level only. */
export const getMissingProviderSecrets = getMissingAppCredentials;

/**
 * True when the developer setup needed to START a connection is present. This is
 * NOT "a user is connected" — see connectedAccounts.hasConnectedAccount.
 */
export function isDeveloperSetupReady(providerId: string): boolean {
  return getMissingAppCredentials(providerId).length === 0;
}

/** @deprecated misleading name; use isDeveloperSetupReady. */
export const isProviderConfigured = isDeveloperSetupReady;

/** Whether DEV_* personal-token shortcuts are enabled (Developer Mode). */
export function devPatShortcutsEnabled(): boolean {
  const v = getProviderSecret('', 'LARUND_ENABLE_DEV_PAT_SHORTCUTS') ?? readDotEnv().LARUND_ENABLE_DEV_PAT_SHORTCUTS;
  return v === 'true' || v === '1';
}

export function hasAnyConfiguredSecret(providerId: string): boolean {
  const schema = envSchemaForProvider(providerId);
  return [...schema.required, ...schema.optional, ...schema.advanced].some((key) => Boolean(getProviderSecret(providerId, key)));
}

export function getProviderSetupStatus(input: {
  providerId: string;
  catalogStatus?: CatalogStatus;
  supportsMcp?: boolean;
  testError?: string;
}): ProviderSetupStatus {
  if (input.catalogStatus === 'coming_soon') return 'coming_soon';
  if (input.testError?.includes('insufficient_scope')) return 'insufficient_scope';
  if (input.testError?.includes('invalid_auth') || /(^|_)40[13]\b/.test(input.testError ?? '')) return 'invalid_auth';
  if (!isProviderConfigured(input.providerId)) return input.supportsMcp ? 'mcp_available' : 'needs_setup';
  return 'connected';
}

export function resetEnvResolverCacheForTests(): void {
  dotenvCache = null;
}
