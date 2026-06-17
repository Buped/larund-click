import type { ConnectionCallResult } from '../../types';
import { mapXStatus, xError } from './errors';

const API = 'https://api.x.com';

export interface XAuthSummary {
  bearerToken?: string;
  userAccessToken?: string;
  userAccessTokenSecret?: string;
  hasWriteTokens: boolean;
}

export function xAuthFromSecrets(secrets: Record<string, string>): XAuthSummary {
  return {
    bearerToken: secrets.X_BEARER_TOKEN,
    userAccessToken: secrets.X_WRITE_ACCESS_TOKEN,
    userAccessTokenSecret: secrets.X_WRITE_ACCESS_TOKEN_SECRET,
    hasWriteTokens: Boolean(secrets.X_WRITE_ACCESS_TOKEN && secrets.X_WRITE_ACCESS_TOKEN_SECRET),
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
    return { success: true, output: text || '{}', details: text ? JSON.parse(text) as Record<string, unknown> : {} };
  } catch (error) {
    return xError('provider_error', `X API request failed: ${String(error)}`);
  }
}

export function readToken(auth: XAuthSummary): string | undefined {
  return auth.bearerToken ?? auth.userAccessToken;
}

export function writeToken(auth: XAuthSummary): string | undefined {
  return auth.userAccessToken;
}
