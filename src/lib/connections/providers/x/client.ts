import type { ConnectionCallResult } from '../../types';
import { mapXStatus, xError } from './errors';

const API = 'https://api.x.com';

export interface XAuthSummary {
  appBearerToken?: string;
  bearerToken?: string;
  userAccessToken?: string;
  userAccessTokenSecret?: string;
  hasWriteTokens: boolean;
  connectedAccountCount: number;
}

export function xAuthFromSecrets(secrets: Record<string, string>): XAuthSummary {
  return {
    appBearerToken: secrets.X_APP_BEARER ?? secrets.X_APP_BEARER_TOKEN,
    bearerToken: secrets.X_APP_BEARER ?? secrets.X_APP_BEARER_TOKEN ?? secrets.X_BEARER_TOKEN,
    userAccessToken: secrets.X_WRITE_ACCESS_TOKEN,
    userAccessTokenSecret: secrets.X_WRITE_ACCESS_TOKEN_SECRET,
    hasWriteTokens: Boolean(secrets.X_WRITE_ACCESS_TOKEN),
    connectedAccountCount: Number(secrets.LARUND_CONNECTED_ACCOUNT_COUNT || 0),
  };
}

export async function xFetch(
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<ConnectionCallResult> {
  if (!token) return xError('missing_auth', 'Connect X / Twitter first.');
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) return mapXStatus(res.status, text);
    let details: Record<string, unknown> = {};
    if (text) {
      try { details = JSON.parse(text) as Record<string, unknown>; } catch { details = { raw: text }; }
    }
    return { success: true, output: text || '{}', details };
  } catch (error) {
    return xError('provider_error', `X API request failed: ${String(error)}`);
  }
}

export function readToken(auth: XAuthSummary): string | undefined {
  return auth.userAccessToken ?? auth.bearerToken ?? auth.appBearerToken;
}

export function writeToken(auth: XAuthSummary): string | undefined {
  return auth.userAccessToken;
}
