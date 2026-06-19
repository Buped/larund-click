// App profile store — user-defined webapps / sites / apps that Larund can operate
// when @-mentioned in chat. An AppProfile bundles where the app lives (urls,
// domain), how to sign in (a linked credential in the secure vault), which browser
// to use, and free-form usage hints. Passwords are NEVER stored here — only a
// pointer (credentialId) into src/lib/credentials/store.ts.

import {
  createCredential, updateCredential, deleteCredential, getCredential,
  normalizeDomain, type LoginCredential,
} from '../credentials/store';

export type AppKind = 'web' | 'native' | 'browser_app';

export interface AppProfile {
  id: string;
  label: string;
  kind: AppKind;
  homeUrl?: string;
  loginUrl?: string;
  domain: string;
  username?: string;
  /** Pointer into the credential vault for the password (never the password itself). */
  credentialId?: string;
  preferredBrowserId?: string;
  notes?: string;
  /** What this app is used for / hints for the agent (safe to put in the prompt). */
  usageHints?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

const STORE_KEY = 'app_profiles';

let apps: AppProfile[] = [];
let hydrated = false;

function now(): string { return new Date().toISOString(); }
function uuid(): string {
  try { return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `app-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
  catch { return `app-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
}

function persist(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(apps)); } catch { /* node/tests: in-memory */ }
}

export function hydrateApps(): void {
  if (hydrated) return;
  hydrated = true;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) apps = JSON.parse(raw) as AppProfile[]; } catch { /* ignore */ }
}

export interface UpsertAppInput {
  label: string;
  kind?: AppKind;
  homeUrl?: string;
  loginUrl?: string;
  domain?: string;
  username?: string;
  /** Plaintext password — stored only in the secure credential vault, then dropped. */
  password?: string;
  preferredBrowserId?: string;
  notes?: string;
  usageHints?: string;
}

function deriveDomain(input: UpsertAppInput): string {
  return normalizeDomain(input.domain || input.homeUrl || input.loginUrl || '');
}

export async function createApp(input: UpsertAppInput): Promise<AppProfile> {
  hydrateApps();
  const id = uuid();
  const ts = now();
  const domain = deriveDomain(input);
  let credentialId: string | undefined;
  if (input.username && input.password) {
    const cred = await createCredential({
      label: input.label.trim() || domain,
      loginUrl: input.loginUrl || input.homeUrl || (domain ? `https://${domain}` : ''),
      username: input.username,
      password: input.password,
      notes: input.notes,
    });
    credentialId = cred.id;
  }
  const app: AppProfile = {
    id,
    label: input.label.trim() || domain || 'App',
    kind: input.kind ?? 'web',
    homeUrl: input.homeUrl?.trim() || undefined,
    loginUrl: input.loginUrl?.trim() || undefined,
    domain,
    username: input.username?.trim() || undefined,
    credentialId,
    preferredBrowserId: input.preferredBrowserId || undefined,
    notes: input.notes?.trim() || undefined,
    usageHints: input.usageHints?.trim() || undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  apps.push(app);
  persist();
  return app;
}

export async function updateApp(id: string, input: Partial<UpsertAppInput>): Promise<AppProfile | undefined> {
  hydrateApps();
  const app = apps.find((a) => a.id === id);
  if (!app) return undefined;
  if (input.label !== undefined) app.label = input.label.trim() || app.label;
  if (input.kind !== undefined) app.kind = input.kind;
  if (input.homeUrl !== undefined) app.homeUrl = input.homeUrl.trim() || undefined;
  if (input.loginUrl !== undefined) app.loginUrl = input.loginUrl.trim() || undefined;
  if (input.notes !== undefined) app.notes = input.notes.trim() || undefined;
  if (input.usageHints !== undefined) app.usageHints = input.usageHints.trim() || undefined;
  if (input.preferredBrowserId !== undefined) app.preferredBrowserId = input.preferredBrowserId || undefined;
  if (input.username !== undefined) app.username = input.username.trim() || undefined;
  if (input.domain !== undefined || input.homeUrl !== undefined || input.loginUrl !== undefined) {
    app.domain = deriveDomain({ ...app, ...input } as UpsertAppInput) || app.domain;
  }
  // Sync the linked credential (create / update) when username or password change.
  if (input.username !== undefined || input.password) {
    if (app.credentialId && getCredential(app.credentialId)) {
      await updateCredential(app.credentialId, {
        username: app.username,
        loginUrl: app.loginUrl || app.homeUrl,
        ...(input.password ? { password: input.password } : {}),
        label: app.label,
      });
    } else if (app.username && input.password) {
      const cred = await createCredential({
        label: app.label, loginUrl: app.loginUrl || app.homeUrl || (app.domain ? `https://${app.domain}` : ''),
        username: app.username, password: input.password, notes: app.notes,
      });
      app.credentialId = cred.id;
    }
  }
  app.updatedAt = now();
  persist();
  return app;
}

export async function deleteApp(id: string): Promise<void> {
  hydrateApps();
  const app = apps.find((a) => a.id === id);
  if (app?.credentialId) await deleteCredential(app.credentialId).catch(() => undefined);
  apps = apps.filter((a) => a.id !== id);
  persist();
}

export function listApps(): AppProfile[] {
  hydrateApps();
  return [...apps].sort((a, b) => a.label.localeCompare(b.label));
}

export function getApp(id: string): AppProfile | undefined {
  hydrateApps();
  return apps.find((a) => a.id === id);
}

export function getAppByDomain(domainOrUrl: string): AppProfile | undefined {
  hydrateApps();
  const host = normalizeDomain(domainOrUrl);
  if (!host) return undefined;
  return apps.find((a) => a.domain === host) ?? apps.find((a) => host.endsWith(`.${a.domain}`) || (a.domain && a.domain.endsWith(`.${host}`)));
}

export function markAppUsed(id: string): void {
  const app = apps.find((a) => a.id === id);
  if (!app) return;
  app.lastUsedAt = now();
  persist();
}

/** Linked credential record for an app, if any (metadata only; no password). */
export function credentialForApp(app: AppProfile): LoginCredential | undefined {
  return app.credentialId ? getCredential(app.credentialId) : undefined;
}

/** Connection state for UI/mention: ready / needs_password / needs_setup. */
export function appStatus(app: AppProfile): 'ready' | 'needs_password' | 'needs_setup' {
  if (!app.loginUrl && !app.homeUrl && !app.domain) return 'needs_setup';
  if (app.username && app.credentialId) return 'ready';
  return 'needs_password';
}

export function __resetAppsForTests(): void {
  apps = [];
  hydrated = false;
}
