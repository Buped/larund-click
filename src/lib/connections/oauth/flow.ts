// Unified OAuth helper. Pure building blocks for the Authorization Code flow
// (with PKCE where supported): state generation/validation, PKCE pair, provider
// authorize-URL building, a standard redirect URI (`/auth/callback/:provider`),
// token exchange, and storing the result in the ConnectedAccount store.
//
// This is the credential plumbing only — it does not own UI or a callback HTTP
// listener. In `LARUND_AUTH_EXCHANGE_MODE=backend` the exchange is delegated to
// the Larund backend so the confidential client secret never ships in the client.

import { getProviderSecret } from '../env/resolve';
import { createConnectedAccount, type ConnectedAccount, type ConnectionContext } from '../connectedAccounts';

export interface OAuthProviderEndpoints {
  /** Short slug used in the redirect path `/auth/callback/<slug>`. */
  slug: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv?: string;
  /** Authorization Code + PKCE supported / required. */
  pkce: boolean;
  /** Default scopes requested at connect time. */
  defaultScopes: string[];
  /** Extra authorize-URL params (e.g. Google offline access). */
  extraAuthParams?: Record<string, string>;
  scopeSeparator?: string;
}

const DEFAULT_CALLBACK_BASE = 'http://localhost:14200';

export const OAUTH_ENDPOINTS: Record<string, OAuthProviderEndpoints> = {
  'google-workspace': {
    slug: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    pkce: true,
    defaultScopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/calendar',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  github: {
    slug: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    pkce: false,
    defaultScopes: ['repo', 'read:user'],
    scopeSeparator: ' ',
  },
  notion: {
    slug: 'notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
    pkce: false,
    defaultScopes: [],
    extraAuthParams: { owner: 'user' },
  },
  slack: {
    slug: 'slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    pkce: false,
    defaultScopes: ['channels:read', 'chat:write'],
    scopeSeparator: ',',
  },
  x: {
    slug: 'x',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    pkce: true,
    defaultScopes: ['tweet.read', 'users.read', 'offline.access'],
  },
  'microsoft-365': {
    slug: 'microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    pkce: true,
    defaultScopes: ['offline_access', 'User.Read', 'Files.ReadWrite', 'Mail.ReadWrite'],
  },
  discord: {
    slug: 'discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    clientIdEnv: 'DISCORD_CLIENT_ID',
    clientSecretEnv: 'DISCORD_CLIENT_SECRET',
    pkce: false,
    defaultScopes: ['identify', 'guilds'],
  },
  'meta-ads': {
    slug: 'meta',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    pkce: false,
    defaultScopes: ['public_profile'],
  },
};

export function oauthEndpoints(providerId: string): OAuthProviderEndpoints | undefined {
  return OAUTH_ENDPOINTS[providerId];
}

// ── State + PKCE ──────────────────────────────────────────────────────────────

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  (globalThis.crypto as Crypto).getRandomValues(out);
  return out;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  // btoa is available in browsers and in Node ≥16 (global).
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function validateState(expected: string | undefined, received: string | undefined): boolean {
  return Boolean(expected) && Boolean(received) && expected === received;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64url(randomBytes(32));
  const digest = await (globalThis.crypto as Crypto).subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest), method: 'S256' };
}

// ── Redirect URI + authorize URL ──────────────────────────────────────────────

/**
 * The standard redirect URI. With the desktop loopback flow every provider uses a
 * single shared loopback origin (LARUND_OAUTH_CALLBACK_BASE, default
 * `http://localhost:14200/`), so the developer registers the same value in each
 * provider console. The live connect overrides this with the dynamic loopback port.
 */
export function redirectUriFor(_providerId?: string): string {
  const base = getProviderSecret('', 'LARUND_OAUTH_CALLBACK_BASE') ?? DEFAULT_CALLBACK_BASE;
  return `${base.replace(/\/+$/, '')}/`;
}

export interface BuildAuthUrlInput {
  providerId: string;
  state: string;
  codeChallenge?: string;
  scopes?: string[];
  /** Override the redirect URI (the loopback flow passes the dynamic port URL). */
  redirectUri?: string;
}

export interface AuthUrlResult {
  url: string;
  redirectUri: string;
  usesPkce: boolean;
}

export function buildAuthorizationUrl(input: BuildAuthUrlInput): AuthUrlResult {
  const ep = OAUTH_ENDPOINTS[input.providerId];
  if (!ep) throw new Error(`no_oauth_endpoints:${input.providerId}`);
  const clientId = getProviderSecret(input.providerId, ep.clientIdEnv);
  if (!clientId) throw new Error(`developer_setup_missing:${ep.clientIdEnv}`);
  const redirectUri = input.redirectUri ?? redirectUriFor(input.providerId);
  const scopes = input.scopes ?? ep.defaultScopes;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: input.state,
    ...(scopes.length ? { scope: scopes.join(ep.scopeSeparator ?? ' ') } : {}),
    ...(ep.extraAuthParams ?? {}),
  });
  if (ep.pkce && input.codeChallenge) {
    params.set('code_challenge', input.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return { url: `${ep.authorizeUrl}?${params.toString()}`, redirectUri, usesPkce: ep.pkce };
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  raw?: Record<string, unknown>;
}

export interface ExchangeInput {
  providerId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
}

function authExchangeMode(): 'local_dev' | 'backend' {
  return getProviderSecret('', 'LARUND_AUTH_EXCHANGE_MODE') === 'backend' ? 'backend' : 'local_dev';
}

/**
 * Exchange an authorization code for tokens. In `local_dev` this calls the
 * provider token endpoint directly using the `.env` client secret. In `backend`
 * mode it must be routed through the Larund backend (caller supplies the result);
 * this function refuses to embed a confidential secret in a distributed client.
 */
export async function exchangeAuthorizationCode(input: ExchangeInput): Promise<OAuthTokens> {
  const ep = OAUTH_ENDPOINTS[input.providerId];
  if (!ep) throw new Error(`no_oauth_endpoints:${input.providerId}`);
  if (authExchangeMode() === 'backend') {
    throw new Error('backend_exchange_required: route token exchange through the Larund backend (LARUND_AUTH_EXCHANGE_MODE=backend).');
  }
  const clientId = getProviderSecret(input.providerId, ep.clientIdEnv);
  if (!clientId) throw new Error(`developer_setup_missing:${ep.clientIdEnv}`);
  const clientSecret = ep.clientSecretEnv ? getProviderSecret(input.providerId, ep.clientSecretEnv) : undefined;
  const redirectUri = input.redirectUri ?? redirectUriFor(input.providerId);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  });

  const res = await fetch(ep.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token_exchange_failed_${res.status}: ${text.slice(0, 200)}`);
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* slack/github may return form-encoded */ }
  if (!json.access_token) {
    const form = new URLSearchParams(text);
    if (form.get('access_token')) json = Object.fromEntries(form.entries());
  }
  const accessToken = String(json.access_token ?? '');
  if (!accessToken) throw new Error('token_exchange_failed: no access_token in response');
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in) || undefined;
  return {
    accessToken,
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    scope: json.scope ? String(json.scope) : undefined,
  };
}

/**
 * Complete a connect: exchange the code (or accept already-exchanged tokens) and
 * persist a ConnectedAccount for the current user. Tokens never touch logs/UI.
 */
export async function completeOAuthConnect(args: {
  providerId: string;
  ctx: ConnectionContext;
  accountLabel: string;
  tokens: OAuthTokens;
  externalAccountEmail?: string;
  externalWorkspaceId?: string;
  externalWorkspaceName?: string;
  scopes?: string[];
}): Promise<ConnectedAccount> {
  return createConnectedAccount({
    ctx: args.ctx,
    providerId: args.providerId,
    accountLabel: args.accountLabel,
    authType: 'oauth2',
    scopes: args.scopes ?? (args.tokens.scope ? args.tokens.scope.split(/[ ,]+/) : []),
    externalAccountEmail: args.externalAccountEmail,
    externalWorkspaceId: args.externalWorkspaceId,
    externalWorkspaceName: args.externalWorkspaceName,
    expiresAt: args.tokens.expiresAt,
    tokens: {
      access_token: args.tokens.accessToken,
      ...(args.tokens.refreshToken ? { refresh_token: args.tokens.refreshToken } : {}),
    },
  });
}
