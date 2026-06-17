import type { ConnectionCallResult } from '../../types';

export type XErrorCode =
  | 'missing_auth'
  | 'invalid_auth'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'not_found'
  | 'provider_error'
  | 'validation_error';

export function xError(code: XErrorCode, message: string, details?: unknown): ConnectionCallResult {
  return {
    success: false,
    output: '',
    error: `${code}: ${message}`,
    details: details && typeof details === 'object' ? { provider: 'x', details } : { provider: 'x' },
  };
}

export function mapXStatus(status: number, body: string): ConnectionCallResult {
  if (status === 401) return xError('invalid_auth', 'X rejected the configured credentials.', body.slice(0, 300));
  if (status === 403) return xError('insufficient_scope', 'X credentials do not have permission for this operation.', body.slice(0, 300));
  if (status === 404) return xError('not_found', 'X resource was not found.', body.slice(0, 300));
  if (status === 429) return xError('rate_limited', 'X API rate limit reached.', body.slice(0, 300));
  return xError('provider_error', `X API returned HTTP ${status}.`, body.slice(0, 300));
}
