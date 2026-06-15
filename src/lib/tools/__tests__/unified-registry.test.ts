import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createCustomApiConnection, createCustomApiTool } from '../../custom-api/store';
import { createMcpServer, setMcpToolApproval } from '../../mcp/store';
import { connectMcpServer, discoverMcpTools } from '../../mcp/discovery';
import { setMockMcpTools } from '../../mcp/client';
import { listUnifiedTools, promptVisibleToolSummary } from '../unified-registry';

beforeEach(() => resetRecordBackendForTests());

describe('unified registry', () => {
  it('lists built-ins and native connection tools', async () => {
    const tools = await listUnifiedTools({ userId: 'u1' });
    expect(tools.some((t) => t.id === 'builtin:file.read')).toBe(true);
    expect(tools.some((t) => t.source === 'connection' && t.name.includes('google.sheets'))).toBe(true);
  });

  it('lists MCP tools only when enabled and approved', async () => {
    const server = await createMcpServer({ userId: 'u1', name: 'MCP', transport: 'stdio', command: 'mock', trustLevel: 'trusted' });
    setMockMcpTools(server.id, [{ name: 'notes.read', description: 'Read workspace notes.' }]);
    await connectMcpServer(server.id);
    const [tool] = await discoverMcpTools(server.id);
    expect((await listUnifiedTools({ userId: 'u1' })).some((t) => t.source === 'mcp')).toBe(false);
    await setMcpToolApproval(tool.id, { approved: true, enabled: true });
    expect((await listUnifiedTools({ userId: 'u1' })).some((t) => t.source === 'mcp')).toBe(true);
  });

  it('filters workspace-scoped custom API tools and bounds prompt summaries', async () => {
    const conn = await createCustomApiConnection({ userId: 'u1', workspaceId: 'ws1', name: 'API', baseUrl: 'https://api.example.com' });
    await createCustomApiTool({ connectionId: conn.id, name: 'get_items', description: 'Read items', method: 'GET', pathTemplate: '/items' });
    expect((await listUnifiedTools({ userId: 'u1', workspaceId: 'ws2' })).some((t) => t.source === 'custom_api')).toBe(false);
    expect((await listUnifiedTools({ userId: 'u1', workspaceId: 'ws1' })).some((t) => t.source === 'custom_api')).toBe(true);
    expect((await promptVisibleToolSummary({ userId: 'u1', limit: 2 })).split('\n')).toHaveLength(2);
  });
});
