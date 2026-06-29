import { describe, expect, it, afterEach } from 'vitest';
import { createConnectionRegistry, listConnections, connectionStatus, ALL_MANIFESTS } from '../registry';
import { githubManifest } from '../providers/github/manifest';
import { createConnectedAccount, __resetConnectedAccountsForTests } from '../connectedAccounts';

type MockGlobal = { LARUND_ALLOW_MOCK_CONNECTIONS?: unknown };
function allowMocks(v: boolean) { (globalThis as MockGlobal).LARUND_ALLOW_MOCK_CONNECTIONS = v; }

describe('connections', () => {
  afterEach(() => {
    delete (globalThis as MockGlobal).LARUND_ALLOW_MOCK_CONNECTIONS;
    __resetConnectedAccountsForTests();
  });

  it('lists all providers with statuses', () => {
    const list = listConnections();
    const ids = list.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['github', 'notion', 'google-workspace', 'x', 'slack', 'hubspot', 'airtable', 'wordpress']));
  });

  it('reports missing_auth for api_key connections without a token', () => {
    expect(connectionStatus(githubManifest)).toBe('missing_auth');
  });

  it('reports scaffold for scaffolded providers', () => {
    const slack = ALL_MANIFESTS.find((m) => m.id === 'slack')!;
    expect(connectionStatus(slack)).toBe('scaffold');
  });

  // ── Production safety: no fake success when auth is missing ──────────────────
  it('github read tool returns missing_auth (not mock) by default', async () => {
    const reg = createConnectionRegistry();
    const res = await reg.call('github', 'read_file', { owner: 'a', repo: 'b', path: 'README.md' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('missing_auth');
    expect(res.output).not.toContain('[mock]');
    expect(res.details?.missingAuth).toBe(true);
  });

  it('notion query tool returns missing_auth (not mock) by default', async () => {
    const reg = createConnectionRegistry();
    const res = await reg.call('notion', 'query_database', { databaseId: 'db1' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('missing_auth');
  });

  it('x read tool returns missing_auth by default', async () => {
    const reg = createConnectionRegistry();
    const res = await reg.call('x', 'search_recent_posts', { query: 'larund' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('missing_auth');
  });

  // ── Dev/test may explicitly opt into mocks ──────────────────────────────────
  it('github read tool returns mock output only when mocks are explicitly allowed', async () => {
    allowMocks(true);
    const reg = createConnectionRegistry();
    const res = await reg.call('github', 'read_file', { owner: 'a', repo: 'b', path: 'README.md' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('[mock]');
    expect(res.details?.mock).toBe(true);
  });

  it('rejects unknown connections, tools and scaffolded calls', async () => {
    const reg = createConnectionRegistry();
    expect((await reg.call('nope', 'x', {})).error).toContain('unknown_connection');
    expect((await reg.call('github', 'no_such_tool', {})).error).toContain('unknown_tool');
    expect((await reg.call('slack', 'send_message', {})).error).toContain('scaffold');
  });

  it('recognizes workspace-scoped Google aliases as the Google Workspace connection', async () => {
    await createConnectedAccount({
      ctx: { userId: 'alice', workspaceId: 'project-1' },
      providerId: 'google-workspace',
      accountLabel: 'Google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });

    const reg = createConnectionRegistry('alice', 'project-1');

    expect(reg.isConfigured('google-workspace')).toBe(true);
    expect(reg.isConfigured('gmail')).toBe(true);
    expect(reg.isConfigured('google-sheets')).toBe(true);
  });
});
