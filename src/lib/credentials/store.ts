// Login credential vault — stores per-site sign-in credentials so the system can
// log in by itself later through its browser.
//
// SECURITY MODEL (mirrors connectedAccounts.ts)
//   • Password VALUES never live in the metadata records below. They are written
//     through the persistent secret store (Tauri plugin-store when available, else
//     localStorage), keyed by an opaque secretRef.
//   • Metadata records carry only the secretRef pointer, the username and a label.
//   • The password is never returned to the model, UI, prompt, logs or evidence.
//     Only resolveCredentialPassword() returns a raw value, for filling a login
//     form inside the executor — it must never be logged or echoed.

import { getSecret, setPersistentSecret, loadPersistentSecret, setSecret } from '../connections/secrets';

export interface LoginCredential {
  id: string;
  label: string;
  /** Full login page URL the user provided. */
  loginUrl: string;
  /** Host derived from loginUrl, used to match the current page. */
  domain: string;
  username: string;
  secretRef: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

const STORE_KEY = 'login_credentials';

let credentials: LoginCredential[] = [];
let hydrated = false;

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  try {
    return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `cred-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  } catch {
    return `cred-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

/** Normalise a URL or host string to a bare lowercase host (no scheme/path/www). */
export function normalizeDomain(input: string): string {
  let s = (input ?? '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
    s = new URL(s).hostname;
  } catch {
    s = s.replace(/^[a-z]+:\/\//, '').split('/')[0];
  }
  return s.replace(/^www\./, '');
}

function secretRefFor(id: string): string {
  return `login_pw:${id}`;
}

function persistSnapshot(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(credentials));
  } catch {
    // Non-browser (tests/node) — in-memory snapshot is the source of truth.
  }
}

export function hydrateCredentials(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) credentials = JSON.parse(raw) as LoginCredential[];
  } catch {
    // ignore
  }
}

export interface CreateCredentialInput {
  label: string;
  loginUrl: string;
  username: string;
  password: string;
  notes?: string;
}

export async function createCredential(input: CreateCredentialInput): Promise<LoginCredential> {
  hydrateCredentials();
  const id = uuid();
  const ts = now();
  const secretRef = secretRefFor(id);
  await setPersistentSecret(secretRef, input.password);
  const cred: LoginCredential = {
    id,
    label: input.label.trim() || normalizeDomain(input.loginUrl) || 'Login',
    loginUrl: input.loginUrl.trim(),
    domain: normalizeDomain(input.loginUrl),
    username: input.username.trim(),
    secretRef,
    notes: input.notes?.trim() || undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  credentials.push(cred);
  persistSnapshot();
  return cred;
}

export interface UpdateCredentialInput {
  label?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  notes?: string;
}

export async function updateCredential(id: string, patch: UpdateCredentialInput): Promise<LoginCredential | undefined> {
  hydrateCredentials();
  const cred = credentials.find((c) => c.id === id);
  if (!cred) return undefined;
  if (patch.label !== undefined) cred.label = patch.label.trim() || cred.label;
  if (patch.loginUrl !== undefined) { cred.loginUrl = patch.loginUrl.trim(); cred.domain = normalizeDomain(patch.loginUrl); }
  if (patch.username !== undefined) cred.username = patch.username.trim();
  if (patch.notes !== undefined) cred.notes = patch.notes.trim() || undefined;
  if (patch.password) await setPersistentSecret(cred.secretRef, patch.password);
  cred.updatedAt = now();
  persistSnapshot();
  return cred;
}

export async function deleteCredential(id: string): Promise<void> {
  hydrateCredentials();
  const cred = credentials.find((c) => c.id === id);
  if (cred) await setPersistentSecret(cred.secretRef, '');
  credentials = credentials.filter((c) => c.id !== id);
  persistSnapshot();
}

export function listCredentials(): LoginCredential[] {
  hydrateCredentials();
  return [...credentials].sort((a, b) => a.label.localeCompare(b.label));
}

/** Best match for a domain/URL: exact host, then suffix match (sub.domain.com). */
export function getCredentialForDomain(domainOrUrl: string): LoginCredential | undefined {
  hydrateCredentials();
  const host = normalizeDomain(domainOrUrl);
  if (!host) return undefined;
  return (
    credentials.find((c) => c.domain === host) ??
    credentials.find((c) => host.endsWith(`.${c.domain}`) || c.domain.endsWith(`.${host}`))
  );
}

export function getCredential(id: string): LoginCredential | undefined {
  hydrateCredentials();
  return credentials.find((c) => c.id === id);
}

export function markCredentialUsed(id: string): void {
  const cred = credentials.find((c) => c.id === id);
  if (!cred) return;
  cred.lastUsedAt = now();
  persistSnapshot();
}

/**
 * Resolve the raw password for filling a login form. The ONLY function that
 * returns the secret value — callers (the executor) must never log or echo it.
 */
export async function resolveCredentialPassword(id: string): Promise<string | undefined> {
  const cred = getCredential(id);
  if (!cred) return undefined;
  const cached = getSecret(cred.secretRef);
  if (cached) return cached;
  return loadPersistentSecret(cred.secretRef);
}

/** Test helper — clears in-memory state (does not touch persisted secrets). */
export function __resetCredentialsForTests(): void {
  for (const c of credentials) setSecret(c.secretRef, '');
  credentials = [];
  hydrated = false;
}
