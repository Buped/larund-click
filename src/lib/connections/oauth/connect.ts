// One-click OAuth connect orchestrator. Drives the full Authorization Code (+ PKCE)
// round-trip using the loopback capture and the pure helpers in flow.ts, then
// stores the result as a per-user ConnectedAccount. The user only clicks "Connect".

import {
  oauthEndpoints, generateState, validateState, createPkcePair,
  buildAuthorizationUrl, exchangeAuthorizationCode, completeOAuthConnect,
  verifyConnectedIdentity,
} from './flow';
import { startLoopback } from './loopback';
import type { ConnectionContext, ConnectedAccount } from '../connectedAccounts';

export interface BeginConnectOptions {
  accountLabel?: string;
  /** Override the scopes requested (defaults to the provider's default scopes). */
  scopes?: string[];
  timeoutMs?: number;
}

export function providerSupportsOAuthConnect(providerId: string): boolean {
  return Boolean(oauthEndpoints(providerId));
}

/**
 * Open the system browser for the provider's OAuth login, capture the redirect on
 * the loopback server, exchange the code, and persist a ConnectedAccount.
 * Throws `oauth_*` errors (no secrets) the UI can surface.
 */
export async function beginOAuthConnect(
  providerId: string,
  ctx: ConnectionContext,
  opts: BeginConnectOptions = {},
): Promise<ConnectedAccount> {
  const ep = oauthEndpoints(providerId);
  if (!ep) throw new Error(`oauth_unsupported_provider: ${providerId}`);

  const handle = await startLoopback();
  try {
    const redirectUri = `http://localhost:${handle.port}/`;
    const state = generateState();
    const pkce = ep.pkce ? await createPkcePair() : undefined;

    const { url } = buildAuthorizationUrl({
      providerId,
      state,
      codeChallenge: pkce?.challenge,
      scopes: opts.scopes,
      redirectUri,
    });

    await openExternal(url);

    const callbackUrl = await handle.waitForRedirect(opts.timeoutMs);
    const parsed = new URL(callbackUrl);
    const providerError = parsed.searchParams.get('error');
    if (providerError) throw new Error(`oauth_provider_error: ${providerError}`);
    if (!validateState(state, parsed.searchParams.get('state') ?? undefined)) {
      throw new Error('oauth_state_mismatch: the redirect state did not match.');
    }
    const code = parsed.searchParams.get('code');
    if (!code) throw new Error('oauth_no_code: no authorization code in the redirect.');

    const tokens = await exchangeAuthorizationCode({ providerId, code, codeVerifier: pkce?.verifier, redirectUri });
    // Verify the token actually works and resolve the account email. For Google
    // this catches missing scopes / disabled APIs at connect time (loud, clear
    // error) instead of surfacing later as a vague task failure.
    const identity = await verifyConnectedIdentity(providerId, tokens.accessToken);
    return await completeOAuthConnect({
      providerId,
      ctx,
      accountLabel: opts.accountLabel?.trim() || identity.email || `${ep.slug} account`,
      tokens,
      externalAccountEmail: identity.email,
      scopes: opts.scopes ?? ep.defaultScopes,
    });
  } finally {
    await handle.cancel();
  }
}

async function openExternal(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
