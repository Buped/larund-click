// ConnectedAccount store — per-user, per-workspace, per-account connected
// provider accounts and their tokens.
//
// SECURITY MODEL
//   • Token VALUES never live in the metadata records below. They are written
//     through the persistent secret store (OS secure store via Tauri plugin-store
//     when available, else localStorage), keyed by an opaque tokenRef.
//   • Metadata records carry only tokenRef pointers, never the secret itself.
//   • Token values are never returned to the model, UI, prompt, logs or evidence.
//     Only getTokenSecretForProviderCall() returns a raw value, for an outbound
//     provider HTTP call.
//   • This is the local/desktop store. Team/SaaS mode swaps the backend for an
//     encrypted server database with the same interface.

import { getSecret, setPersistentSecret, loadPersistentSecret, setSecret } from './secrets';

export type ConnectedAccountStatus =
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'insufficient_scope'
  | 'error';

export type ConnectedAuthType = 'oauth2' | 'oauth1a' | 'api_key' | 'pat' | 'mcp';

export interface ConnectedAccount {
  id: string;
  userId: string;
  workspaceId?: string;
  providerId: string;
  accountLabel: string;
  externalAccountId?: string;
  externalAccountEmail?: string;
  externalWorkspaceId?: string;
  externalWorkspaceName?: string;
  authType: ConnectedAuthType;
  scopes: string[];
  status: ConnectedAccountStatus;
  tokenRef?: string;
  refreshTokenRef?: string;
  expiresAt?: string;
  connectedAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  metadata?: Record<string, unknown>;
}

export type TokenKind =
  | 'access_token'
  | 'refresh_token'
  | 'id_token'
  | 'api_key'
  | 'oauth1_token'
  | 'oauth1_token_secret';

export interface ConnectionContext {
  userId: string;
  workspaceId?: string;
}

export const DEFAULT_CONTEXT: ConnectionContext = { userId: 'local' };

const ACCOUNTS_STORE_KEY = 'connected_accounts';

// In-memory snapshot for synchronous reads (hydrated from persistence at startup).
let accounts: ConnectedAccount[] = [];
let hydrated = false;

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  try {
    return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  } catch {
    return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

function tokenRefFor(accountId: string, kind: TokenKind): string {
  return `cat:${accountId}:${kind}`;
}

// ── Persistence (metadata only; never token values) ──────────────────────────

function persistSnapshot(): void {
  try {
    localStorage.setItem(ACCOUNTS_STORE_KEY, JSON.stringify(accounts));
  } catch {
    // Non-browser (tests/node) — in-memory snapshot is the source of truth.
  }
}

/** Load account metadata from persistence into the in-memory snapshot. */
export function hydrateConnectedAccounts(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORE_KEY);
    if (raw) accounts = JSON.parse(raw) as ConnectedAccount[];
  } catch {
    // ignore
  }
}

// ── Token secrets ────────────────────────────────────────────────────────────

export interface TokenSecretInput {
  connectedAccountId: string;
  kind: TokenKind;
  value: string;
}

/** Store a token value in the secure store and return its opaque tokenRef. */
export async function storeTokenSecret(input: TokenSecretInput): Promise<string> {
  const ref = tokenRefFor(input.connectedAccountId, input.kind);
  await setPersistentSecret(ref, input.value);
  return ref;
}

async function deleteTokenSecret(ref: string | undefined): Promise<void> {
  if (!ref) return;
  await setPersistentSecret(ref, '');
}

/**
 * Resolve the raw token value for an outbound provider call. The ONLY function
 * that returns a secret value — callers must never log or echo it.
 */
export async function getTokenSecretForProviderCall(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const cached = getSecret(ref);
  if (cached) return cached;
  return loadPersistentSecret(ref);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateConnectedAccountInput {
  ctx: ConnectionContext;
  providerId: string;
  accountLabel: string;
  authType: ConnectedAuthType;
  scopes?: string[];
  externalAccountId?: string;
  externalAccountEmail?: string;
  externalWorkspaceId?: string;
  externalWorkspaceName?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  tokens?: Partial<Record<TokenKind, string>>;
  status?: ConnectedAccountStatus;
}

export async function createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
  hydrateConnectedAccounts();
  const id = uuid();
  const ts = now();
  const account: ConnectedAccount = {
    id,
    userId: input.ctx.userId,
    workspaceId: input.ctx.workspaceId,
    providerId: input.providerId,
    accountLabel: input.accountLabel,
    externalAccountId: input.externalAccountId,
    externalAccountEmail: input.externalAccountEmail,
    externalWorkspaceId: input.externalWorkspaceId,
    externalWorkspaceName: input.externalWorkspaceName,
    authType: input.authType,
    scopes: input.scopes ?? [],
    status: input.status ?? 'connected',
    expiresAt: input.expiresAt,
    connectedAt: ts,
    updatedAt: ts,
    metadata: input.metadata,
  };
  for (const [kind, value] of Object.entries(input.tokens ?? {})) {
    if (!value) continue;
    const ref = await storeTokenSecret({ connectedAccountId: id, kind: kind as TokenKind, value });
    if (kind === 'refresh_token') account.refreshTokenRef = ref;
    else if (account.tokenRef === undefined) account.tokenRef = ref;
  }
  accounts.push(account);
  persistSnapshot();
  return account;
}

export async function updateConnectedAccount(
  id: string,
  patch: Partial<Omit<ConnectedAccount, 'id' | 'userId' | 'providerId' | 'connectedAt'>> & { tokens?: Partial<Record<TokenKind, string>> },
): Promise<ConnectedAccount | undefined> {
  hydrateConnectedAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account) return undefined;
  const { tokens, ...rest } = patch;
  Object.assign(account, rest);
  for (const [kind, value] of Object.entries(tokens ?? {})) {
    if (!value) continue;
    const ref = await storeTokenSecret({ connectedAccountId: id, kind: kind as TokenKind, value });
    if (kind === 'refresh_token') account.refreshTokenRef = ref;
    else account.tokenRef = ref;
  }
  account.updatedAt = now();
  persistSnapshot();
  return account;
}

export async function disconnectConnectedAccount(id: string): Promise<void> {
  hydrateConnectedAccounts();
  const account = accounts.find((a) => a.id === id);
  if (account) {
    await deleteTokenSecret(account.tokenRef);
    await deleteTokenSecret(account.refreshTokenRef);
  }
  accounts = accounts.filter((a) => a.id !== id);
  persistSnapshot();
}

function inContext(a: ConnectedAccount, ctx: ConnectionContext): boolean {
  if (a.userId !== ctx.userId) return false;
  if (ctx.workspaceId && a.workspaceId && a.workspaceId !== ctx.workspaceId) return false;
  return true;
}

export function listConnectedAccounts(ctx: ConnectionContext = DEFAULT_CONTEXT): ConnectedAccount[] {
  hydrateConnectedAccounts();
  return accounts.filter((a) => inContext(a, ctx));
}

export function listConnectedAccountsForProvider(providerId: string, ctx: ConnectionContext = DEFAULT_CONTEXT): ConnectedAccount[] {
  return listConnectedAccounts(ctx).filter((a) => a.providerId === providerId);
}

/** The active connected account for a provider in this context (first match). */
export function getConnectedAccount(providerId: string, ctx: ConnectionContext = DEFAULT_CONTEXT): ConnectedAccount | undefined {
  return listConnectedAccountsForProvider(providerId, ctx).find((a) => a.status === 'connected') ??
    listConnectedAccountsForProvider(providerId, ctx)[0];
}

export function hasConnectedAccount(providerId: string, ctx: ConnectionContext = DEFAULT_CONTEXT): boolean {
  return listConnectedAccountsForProvider(providerId, ctx).some((a) => a.status === 'connected');
}

export function markAccountStatus(id: string, status: ConnectedAccountStatus): void {
  const account = accounts.find((a) => a.id === id);
  if (!account) return;
  account.status = status;
  account.updatedAt = now();
  account.lastTestedAt = now();
  persistSnapshot();
}

/**
 * Earlier local-first builds stored user connections under the synthetic
 * "local" user. Once real auth is active, chat/tool calls use the real user id.
 * Move those legacy account metadata records forward so the same token refs stay
 * usable without asking the user to reconnect.
 */
export function adoptLegacyLocalConnectedAccounts(userId: string): number {
  hydrateConnectedAccounts();
  if (!userId || userId === DEFAULT_CONTEXT.userId) return 0;
  let moved = 0;
  for (const account of accounts) {
    if (account.userId !== DEFAULT_CONTEXT.userId) continue;
    account.userId = userId;
    account.updatedAt = now();
    moved += 1;
  }
  if (moved > 0) persistSnapshot();
  return moved;
}

/** Refresh a provider token if it is close to expiry. Returns true if refreshed. */
export async function refreshProviderTokenIfNeeded(
  id: string,
  refresh: (refreshToken: string) => Promise<{ accessToken: string; expiresAt?: string; refreshToken?: string }>,
): Promise<boolean> {
  const account = accounts.find((a) => a.id === id);
  if (!account || !account.refreshTokenRef) return false;
  const skewMs = 60_000;
  if (account.expiresAt && Date.parse(account.expiresAt) - Date.now() > skewMs) return false;
  const refreshToken = await getTokenSecretForProviderCall(account.refreshTokenRef);
  if (!refreshToken) return false;
  const next = await refresh(refreshToken);
  await updateConnectedAccount(id, {
    expiresAt: next.expiresAt,
    status: 'connected',
    tokens: { access_token: next.accessToken, ...(next.refreshToken ? { refresh_token: next.refreshToken } : {}) },
  });
  return true;
}

/** Revoke a connected account if the provider supports revocation, then remove it. */
export async function revokeConnectedAccountIfProviderSupportsIt(
  id: string,
  revoke?: (token: string) => Promise<void>,
): Promise<void> {
  const account = accounts.find((a) => a.id === id);
  if (account && revoke) {
    const token = await getTokenSecretForProviderCall(account.tokenRef);
    if (token) {
      try { await revoke(token); } catch { /* best effort */ }
    }
  }
  await disconnectConnectedAccount(id);
}

/** Test helper — clears in-memory state (does not touch persisted secrets). */
export function __resetConnectedAccountsForTests(): void {
  for (const a of accounts) {
    if (a.tokenRef) setSecret(a.tokenRef, '');
    if (a.refreshTokenRef) setSecret(a.refreshTokenRef, '');
  }
  accounts = [];
  hydrated = false;
}
