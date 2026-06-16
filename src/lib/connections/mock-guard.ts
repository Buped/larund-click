// Production safety: connection tools must never fake success when credentials
// are missing. A provider may only return a "[mock]" response when mock mode is
// explicitly enabled — which we restrict to dev/test. In the normal app, a
// missing token yields a structured `missing_auth` error with setup guidance so
// Chat/Tasks can surface a real blocker (and offer a Connect action) instead of
// hallucinating a result.

import type { ConnectionCallResult } from '../tools/types';

/**
 * Whether mock connection responses are allowed. Off by default; enabled only by
 * an explicit opt-in so automated tests (and local experimentation) can still use
 * mocks without shipping fake success to real users.
 *
 * Enable via any of:
 *   - Vite env:        VITE_LARUND_ALLOW_MOCK_CONNECTIONS=true
 *   - Node/test env:   LARUND_ALLOW_MOCK_CONNECTIONS=true
 *   - Runtime global:  globalThis.LARUND_ALLOW_MOCK_CONNECTIONS = true
 */
export function mockConnectionsAllowed(): boolean {
  try {
    const g = globalThis as unknown as { LARUND_ALLOW_MOCK_CONNECTIONS?: unknown };
    if (g.LARUND_ALLOW_MOCK_CONNECTIONS === true || g.LARUND_ALLOW_MOCK_CONNECTIONS === 'true') return true;
  } catch { /* ignore */ }
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (env?.VITE_LARUND_ALLOW_MOCK_CONNECTIONS === 'true') return true;
    // Vitest runs in node with import.meta.env defined; tests opt in explicitly.
    if (env?.MODE === 'test' && env?.VITE_LARUND_ALLOW_MOCK_CONNECTIONS !== 'false') {
      // do not auto-enable; tests must set the global flag.
    }
  } catch { /* ignore */ }
  try {
    const p = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    if (p?.env?.LARUND_ALLOW_MOCK_CONNECTIONS === 'true') return true;
  } catch { /* ignore */ }
  return false;
}

/** Structured missing-auth failure with an actionable, secret-free message. */
export function missingAuth(provider: string, tool: string, instruction?: string): ConnectionCallResult {
  const extra = instruction ? ` ${instruction}` : '';
  return {
    success: false,
    output: '',
    error: `missing_auth: ${provider} is not connected — cannot run ${tool}. Connect ${provider} in Connections, then retry.${extra}`,
    details: { missingAuth: true, provider },
  };
}

/**
 * Resolve a no-credentials call: return the mock result when mocks are allowed,
 * otherwise a real `missing_auth` failure. Providers call this in their
 * `if (!token)` branch instead of faking success.
 */
export function mockOrMissingAuth(
  provider: string,
  tool: string,
  mockOutput: string,
  instruction?: string,
): ConnectionCallResult {
  if (mockConnectionsAllowed()) {
    return { success: true, output: `[mock] ${mockOutput}`, details: { mock: true } };
  }
  return missingAuth(provider, tool, instruction);
}
