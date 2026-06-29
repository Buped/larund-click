import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveRuntimeCredentials } from '../runtimeCredentials';
import { createConnectedAccount, markAccountStatus, __resetConnectedAccountsForTests } from '../connectedAccounts';
import { setSecret } from '../secrets';

const ENV_KEYS = ['LARUND_ENABLE_DEV_PAT_SHORTCUTS', 'DEV_GITHUB_TOKEN', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'HIGGSFIELD_MCP_URL'];

beforeEach(() => __resetConnectedAccountsForTests());
afterEach(() => {
  __resetConnectedAccountsForTests();
  for (const k of ENV_KEYS) { setSecret(k, ''); delete process.env[k]; }
});

describe('runtime credential resolution', () => {
  it('blocks with developer_setup_missing when neither account nor app creds exist', async () => {
    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(r.ok).toBe(false);
    expect(r.blocker).toBe('developer_setup_missing');
    // The app-level client secret is never exposed as a user token.
    expect(r.secrets.GITHUB_TOKEN).toBeUndefined();
  });

  it('never uses the app client secret as a user token (not_connected when app creds present)', async () => {
    process.env.GITHUB_CLIENT_ID = 'client-id';
    process.env.GITHUB_CLIENT_SECRET = 'client-secret';
    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(r.ok).toBe(false);
    expect(r.blocker).toBe('not_connected');
    expect(r.secrets.GITHUB_TOKEN).toBeUndefined();
    // App creds are available for the (backend) exchange, but are not user tokens.
    expect(r.secrets.GITHUB_CLIENT_SECRET).toBe('client-secret');
  });

  it('uses the connected user token and maps it to the tool env key', async () => {
    await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'github', accountLabel: 'a', authType: 'oauth2', tokens: { access_token: 'ghp_user_token' } });
    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(r.ok).toBe(true);
    expect(r.source).toBe('connected_account');
    expect(r.secrets.GITHUB_TOKEN).toBe('ghp_user_token');
    // A different user is still not connected.
    const other = await resolveRuntimeCredentials('github', { userId: 'bob' });
    expect(other.ok).toBe(false);
  });

  it('resolves Google credentials for workspace-scoped and user-global accounts', async () => {
    await createConnectedAccount({
      ctx: { userId: 'alice', workspaceId: 'project-1' },
      providerId: 'google-workspace',
      accountLabel: 'workspace google',
      authType: 'oauth2',
      tokens: { access_token: 'workspace_google_token' },
    });
    const scoped = await resolveRuntimeCredentials('google-workspace', { userId: 'alice', workspaceId: 'project-1' });
    expect(scoped.ok).toBe(true);
    expect(scoped.secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN).toBe('workspace_google_token');

    __resetConnectedAccountsForTests();
    await createConnectedAccount({
      ctx: { userId: 'alice' },
      providerId: 'google-workspace',
      accountLabel: 'global google',
      authType: 'oauth2',
      tokens: { access_token: 'global_google_token' },
    });
    const global = await resolveRuntimeCredentials('google-workspace', { userId: 'alice', workspaceId: 'project-1' });
    expect(global.ok).toBe(true);
    expect(global.secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN).toBe('global_google_token');
  });

  it('normalizes Google provider aliases before resolving credentials', async () => {
    await createConnectedAccount({
      ctx: { userId: 'alice', workspaceId: 'project-1' },
      providerId: 'google-workspace',
      accountLabel: 'google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });

    const r = await resolveRuntimeCredentials('gmail', { userId: 'alice', workspaceId: 'project-1' });

    expect(r.ok).toBe(true);
    expect(r.secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN).toBe('google-token');
  });

  it('can use a legacy local account for an authenticated user during migration', async () => {
    await createConnectedAccount({ ctx: { userId: 'local' }, providerId: 'github', accountLabel: 'legacy', authType: 'oauth2', tokens: { access_token: 'ghp_legacy_token' } });

    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });

    expect(r.ok).toBe(true);
    expect(r.source).toBe('connected_account');
    expect(r.account?.userId).toBe('local');
    expect(r.secrets.GITHUB_TOKEN).toBe('ghp_legacy_token');
  });

  it('falls back to a DEV_* shortcut only when Developer Mode is enabled', async () => {
    setSecret('DEV_GITHUB_TOKEN', 'ghp_dev_shortcut');
    // Disabled by default → still blocked.
    const blocked = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(blocked.ok).toBe(false);

    setSecret('LARUND_ENABLE_DEV_PAT_SHORTCUTS', 'true');
    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(r.ok).toBe(true);
    expect(r.source).toBe('dev_shortcut');
    expect(r.secrets.GITHUB_TOKEN).toBe('ghp_dev_shortcut');
  });

  it('surfaces a precise blocker for an expired connected account', async () => {
    const acct = await createConnectedAccount({ ctx: { userId: 'alice' }, providerId: 'github', accountLabel: 'a', authType: 'oauth2', tokens: { access_token: 'tok' } });
    markAccountStatus(acct.id, 'expired');
    const r = await resolveRuntimeCredentials('github', { userId: 'alice' });
    expect(r.ok).toBe(false);
    expect(r.blocker).toBe('expired');
  });

  it('resolves MCP providers from the configured server URL', async () => {
    setSecret('HIGGSFIELD_MCP_URL', 'https://mcp.higgsfield.ai/');
    const r = await resolveRuntimeCredentials('higgsfield', { userId: 'alice' });
    expect(r.ok).toBe(true);
    expect(r.source).toBe('mcp');
  });
});
