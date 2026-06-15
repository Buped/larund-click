import type { McpClient, McpPrompt, McpResource, McpServerConfig, McpToolDefinition } from './types';

const mockTools = new Map<string, McpToolDefinition[]>();

export function setMockMcpTools(serverId: string, tools: McpToolDefinition[]): void {
  mockTools.set(serverId, tools);
}

export class MockMcpClient implements McpClient {
  private connected = new Set<string>();

  async connect(config: McpServerConfig): Promise<void> {
    if (!config.enabled) throw new Error('mcp_server_disabled');
    this.connected.add(config.id);
    if (!mockTools.has(config.id)) {
      mockTools.set(config.id, [
        {
          name: 'notes.read',
          title: 'Read notes',
          description: 'Read-only note lookup for the active workspace.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
        },
      ]);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    this.connected.delete(serverId);
  }

  async listTools(serverId: string): Promise<McpToolDefinition[]> {
    this.assertConnected(serverId);
    return mockTools.get(serverId) ?? [];
  }

  async listResources(serverId: string): Promise<McpResource[]> {
    this.assertConnected(serverId);
    return [{ uri: `mcp://${serverId}/resources/readme`, name: 'Readme', description: 'Mock MCP resource' }];
  }

  async listPrompts(serverId: string): Promise<McpPrompt[]> {
    this.assertConnected(serverId);
    return [{ name: 'summarize', description: 'Mock summarize prompt' }];
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string; details?: Record<string, unknown> }> {
    this.assertConnected(serverId);
    const tool = (mockTools.get(serverId) ?? []).find((candidate) => candidate.name === toolName);
    if (!tool) return { success: false, output: '', details: { serverId, toolName }, error: 'mcp_tool_not_found' } as never;
    return { success: true, output: `Mock MCP ${toolName} result for ${JSON.stringify(args)}`, details: { serverId, toolName } };
  }

  async readResource(serverId: string, resourceUri: string): Promise<{ success: boolean; output: string }> {
    this.assertConnected(serverId);
    return { success: true, output: `Mock resource ${resourceUri}` };
  }

  async getPrompt(serverId: string, promptName: string): Promise<{ success: boolean; output: string }> {
    this.assertConnected(serverId);
    return { success: true, output: `Mock prompt ${promptName}` };
  }

  async healthCheck(serverId: string): Promise<{ ok: boolean; message: string }> {
    return { ok: this.connected.has(serverId), message: this.connected.has(serverId) ? 'connected' : 'not_connected' };
  }

  private assertConnected(serverId: string): void {
    if (!this.connected.has(serverId)) throw new Error(`mcp_not_connected:${serverId}`);
  }
}

let activeClient: McpClient = new MockMcpClient();

export function setMcpClient(client: McpClient): void {
  activeClient = client;
}

export function mcpClient(): McpClient {
  return activeClient;
}
