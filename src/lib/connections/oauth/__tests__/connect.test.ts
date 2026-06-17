import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Capture the URL the orchestrator opens, and drive the loopback redirect from it.
const h = vi.hoisted(() => ({ openedUrl: '', redirectState: 'use-opened' as string }));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: async (u: string) => { h.openedUrl = u; },
}));

vi.mock('../loopback', () => ({
  startLoopback: async () => ({
    port: 14200,
    waitForRedirect: async () => {
      const opened = new URL(h.openedUrl);
      const state = h.redirectState === 'use-opened' ? opened.searchParams.get('state') : h.redirectState;
      return `http://localhost:14200/?code=test-code&state=${state}`;
    },
    cancel: async () => {},
  }),
}));

import { beginOAuthConnect } from '../connect';
import { getConnectedAccount, getTokenSecretForProviderCall, hasConnectedAccount, __resetConnectedAccountsForTests } from '../../connectedAccounts';
import { setSecret } from '../../secrets';

beforeEach(() => {
  __resetConnectedAccountsForTests();
  h.openedUrl = '';
  h.redirectState = 'use-opened';
  setSecret('GITHUB_CLIENT_ID', 'gh-client-id');
  setSecret('GITHUB_CLIENT_SECRET', 'gh-client-secret');
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'gho_user_token', refresh_token: 'r1', expires_in: 3600, scope: 'repo read:user' }), { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  setSecret('GITHUB_CLIENT_ID', '');
  setSecret('GITHUB_CLIENT_SECRET', '');
  vi.restoreAllMocks();
});

describe('one-click OAuth connect', () => {
  it('opens the browser, captures the redirect, exchanges the code, and stores a ConnectedAccount', async () => {
    const account = await beginOAuthConnect('github', { userId: 'alice' }, { accountLabel: 'work' });
    expect(account.providerId).toBe('github');
    expect(account.accountLabel).toBe('work');
    expect(account.status).toBe('connected');
    // Browser was opened to the GitHub authorize endpoint with our client id + state.
    expect(h.openedUrl).toContain('github.com/login/oauth/authorize');
    expect(h.openedUrl).toContain('client_id=gh-client-id');
    expect(h.openedUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A14200%2F');
    // The user token landed in the store, retrievable only via the explicit accessor.
    expect(hasConnectedAccount('github', { userId: 'alice' })).toBe(true);
    expect(await getTokenSecretForProviderCall(account.tokenRef)).toBe('gho_user_token');
    expect(JSON.stringify(account)).not.toContain('gho_user_token');
  });

  it('isolates the connected account per user', async () => {
    await beginOAuthConnect('github', { userId: 'alice' });
    expect(hasConnectedAccount('github', { userId: 'alice' })).toBe(true);
    expect(getConnectedAccount('github', { userId: 'bob' })).toBeUndefined();
  });

  it('rejects a state mismatch and stores nothing', async () => {
    h.redirectState = 'tampered-state';
    await expect(beginOAuthConnect('github', { userId: 'alice' })).rejects.toThrow(/oauth_state_mismatch/);
    expect(hasConnectedAccount('github', { userId: 'alice' })).toBe(false);
  });

  it('surfaces a clear error when developer setup is missing', async () => {
    setSecret('GITHUB_CLIENT_ID', '');
    await expect(beginOAuthConnect('github', { userId: 'alice' })).rejects.toThrow(/developer_setup_missing/);
  });
});
