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

/**
 * Routes each MCP call to the right transport: real Streamable-HTTP servers go to
 * the live client; stdio servers (only offered under Developer Mode) use the
 * mock. Real remote servers therefore use a genuine MCP client path, while the
 * mock stays available for local/dev validation. Transport is resolved from the
 * config on connect and cached; other methods fall back to the store.
 */
type Route = 'http' | 'cli' | 'mock';

export class RoutingMcpClient implements McpClient {
  private mock = new MockMcpClient();
  private route = new Map<string, Route>();
  private http: McpClient | null = null;
  private cli: McpClient | null = null;

  private async httpClient(): Promise<McpClient> {
    if (!this.http) {
      const mod = await import('./http-client');
      this.http = new mod.StreamableHttpMcpClient();
    }
    return this.http;
  }

  private async cliClient(): Promise<McpClient> {
    if (!this.cli) {
      const mod = await import('./higgsfield/client');
      this.cli = new mod.HiggsfieldCliClient();
    }
    return this.cli;
  }

  private routeFor(config: McpServerConfig): Route {
    if (config.transport === 'streamable_http' && config.url) return 'http';
    if (config.transport === 'cli_adapter') return 'cli';
    return 'mock';
  }

  private async clientFor(which: Route): Promise<McpClient> {
    if (which === 'http') return this.httpClient();
    if (which === 'cli') return this.cliClient();
    return this.mock;
  }

  private async pick(serverId: string): Promise<McpClient> {
    let which = this.route.get(serverId);
    if (!which) {
      // Resolve lazily for calls that skip connect (e.g. callMcpTool).
      const { getMcpServer } = await import('./store');
      const server = await getMcpServer(serverId);
      which = server ? this.routeFor(server) : 'mock';
      this.route.set(serverId, which);
    }
    return this.clientFor(which);
  }

  async connect(config: McpServerConfig): Promise<void> {
    const which = this.routeFor(config);
    this.route.set(config.id, which);
    return (await this.clientFor(which)).connect(config);
  }
  async disconnect(serverId: string) { return (await this.pick(serverId)).disconnect(serverId); }
  async listTools(serverId: string) { return (await this.pick(serverId)).listTools(serverId); }
  async listResources(serverId: string) { return (await this.pick(serverId)).listResources(serverId); }
  async listPrompts(serverId: string) { return (await this.pick(serverId)).listPrompts(serverId); }
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) { return (await this.pick(serverId)).callTool(serverId, toolName, args); }
  async readResource(serverId: string, uri: string) { return (await this.pick(serverId)).readResource(serverId, uri); }
  async getPrompt(serverId: string, name: string, args?: Record<string, unknown>) { return (await this.pick(serverId)).getPrompt(serverId, name, args); }
  async healthCheck(serverId: string) { return (await this.pick(serverId)).healthCheck(serverId); }
}

let activeClient: McpClient = new RoutingMcpClient();

export function setMcpClient(client: McpClient): void {
  activeClient = client;
}

export function mcpClient(): McpClient {
  return activeClient;
}
