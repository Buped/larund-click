import { describe, expect, it, beforeEach } from 'vitest';
import {
  createConnectedAccount, listConnectedAccountsForProvider, getConnectedAccount,
  hasConnectedAccount, disconnectConnectedAccount, getTokenSecretForProviderCall,
  markAccountStatus, __resetConnectedAccountsForTests,
} from '../connectedAccounts';

beforeEach(() => __resetConnectedAccountsForTests());

describe('ConnectedAccount store', () => {
  it('creates a connected account and stores the token via an opaque ref', async () => {
    const account = await createConnectedAccount({
      ctx: { userId: 'alice' },
      providerId: 'github',
      accountLabel: 'alice work',
      authType: 'oauth2',
      scopes: ['repo'],
      tokens: { access_token: 'ghp_alice_secret_token_value' },
    });
    expect(account.tokenRef).toBeTruthy();
    // The secret value is NEVER part of the metadata record.
    expect(JSON.stringify(account)).not.toContain('ghp_alice_secret_token_value');
    // It is retrievable only through the explicit provider-call accessor.
    expect(await getTokenSecretForProviderCall(account.tokenRef)).toBe('ghp_alice_secret_token_value');
  });

  it('scopes accounts per user — one user cannot see another user token', async () => {
    await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'github', accountLabel: 'a', authType: 'oauth2', tokens: { access_token: 'tok-a' } });
    await createConnectedAccount({ ctx: { userId: 'bob' }, providerId: 'github', accountLabel: 'b', authType: 'oauth2', tokens: { access_token: 'tok-b' } });

    expect(hasConnectedAccount('github', { userId: 'alice' })).toBe(true);
    expect(hasConnectedAccount('github', { userId: 'bob' })).toBe(true);
    expect(listConnectedAccountsForProvider('github', { userId: 'alice' })).toHaveLength(1);
    expect(getConnectedAccount('github', { userId: 'alice' })?.accountLabel).toBe('a');
    expect(getConnectedAccount('github', { userId: 'carol' })).toBeUndefined();
  });

  it('supports multiple accounts for the same provider/user', async () => {
    await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'google-workspace', accountLabel: 'personal', authType: 'oauth2', tokens: { access_token: 't1' } });
    await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'google-workspace', accountLabel: 'work', authType: 'oauth2', tokens: { access_token: 't2' } });
    expect(listConnectedAccountsForProvider('google-workspace', { userId: 'alice' })).toHaveLength(2);
  });

  it('disconnect removes the account and is reflected in connection state', async () => {
    const account = await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'notion', accountLabel: 'n', authType: 'oauth2', tokens: { access_token: 'tok' } });
    await disconnectConnectedAccount(account.id);
    expect(hasConnectedAccount('notion', { userId: 'alice' })).toBe(false);
    expect(await getTokenSecretForProviderCall(account.tokenRef)).toBeUndefined();
  });

  it('expired/revoked accounts are no longer "connected"', async () => {
    const account = await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'slack', accountLabel: 's', authType: 'oauth2', tokens: { access_token: 'tok' } });
    markAccountStatus(account.id, 'expired');
    expect(hasConnectedAccount('slack', { userId: 'alice' })).toBe(false);
    expect(getConnectedAccount('slack', { userId: 'alice' })?.status).toBe('expired');
  });
});
