import { describe, expect, it } from 'vitest';
import { createConnectionRegistry, listConnections, connectionStatus, ALL_MANIFESTS } from '../registry';
import { githubManifest } from '../providers/github/manifest';

describe('connections', () => {
  it('lists all providers with statuses', () => {
    const list = listConnections();
    const ids = list.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['github', 'notion', 'google-workspace', 'slack', 'hubspot', 'airtable', 'wordpress']));
  });

  it('reports missing_auth for api_key connections without a token', () => {
    expect(connectionStatus(githubManifest)).toBe('missing_auth');
  });

  it('reports scaffold for scaffolded providers', () => {
    const slack = ALL_MANIFESTS.find((m) => m.id === 'slack')!;
    expect(connectionStatus(slack)).toBe('scaffold');
  });

  it('github read tool returns mock output without a token', async () => {
    const reg = createConnectionRegistry();
    const res = await reg.call('github', 'read_file', { owner: 'a', repo: 'b', path: 'README.md' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('[mock]');
    expect(res.details?.mock).toBe(true);
  });

  it('notion query tool returns mock output without a token', async () => {
    const reg = createConnectionRegistry();
    const res = await reg.call('notion', 'query_database', { databaseId: 'db1' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('[mock]');
  });

  it('rejects unknown connections, tools and scaffolded calls', async () => {
    const reg = createConnectionRegistry();
    expect((await reg.call('nope', 'x', {})).error).toContain('unknown_connection');
    expect((await reg.call('github', 'no_such_tool', {})).error).toContain('unknown_tool');
    expect((await reg.call('slack', 'send_message', {})).error).toContain('scaffold');
  });
});
