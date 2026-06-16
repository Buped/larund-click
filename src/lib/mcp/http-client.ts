// Real MCP client over Streamable HTTP (JSON-RPC 2.0). This is the production
// path for remote MCP servers added in the MCP page. It performs a genuine
// `initialize` handshake, capability/tool/resource/prompt discovery, and
// `tools/call`. Auth headers are sent to the server but never logged or returned
// to the model/evidence. stdio transport is not implemented in the webview — the
// UI only offers stdio under Developer Mode, which routes to the mock client.

import type {
  McpClient, McpPrompt, McpResource, McpServerConfig, McpToolDefinition,
} from './types';
import { getMcpServer } from './store';

const PROTOCOL_VERSION = '2025-06-18';

interface Session {
  config: McpServerConfig;
  sessionId?: string;
  initialized: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class StreamableHttpMcpClient implements McpClient {
  private sessions = new Map<string, Session>();
  private nextId = 1;

  async connect(config: McpServerConfig): Promise<void> {
    if (!config.enabled) throw new Error('mcp_server_disabled');
    if (!config.url) throw new Error('mcp_missing_url');
    const session: Session = { config, initialized: false };
    this.sessions.set(config.id, session);
    const result = await this.rpc(session, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'Larund', version: '1.0.0' },
    }) as { protocolVersion?: string } | undefined;
    if (!result) throw new Error('mcp_initialize_failed');
    // Best-effort initialized notification (servers may require it).
    await this.notify(session, 'notifications/initialized').catch(() => undefined);
    session.initialized = true;
  }

  async disconnect(serverId: string): Promise<void> {
    this.sessions.delete(serverId);
  }

  async listTools(serverId: string): Promise<McpToolDefinition[]> {
    const session = await this.session(serverId);
    const res = await this.rpc(session, 'tools/list', {}) as { tools?: unknown[] } | undefined;
    const tools = Array.isArray(res?.tools) ? res!.tools : [];
    return tools.map((t) => {
      const tool = t as Record<string, unknown>;
      return {
        name: String(tool.name ?? ''),
        title: typeof tool.title === 'string' ? tool.title : undefined,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      } satisfies McpToolDefinition;
    }).filter((t) => t.name);
  }

  async listResources(serverId: string): Promise<McpResource[]> {
    const session = await this.session(serverId);
    const res = await this.rpc(session, 'resources/list', {}).catch(() => undefined) as { resources?: unknown[] } | undefined;
    const items = Array.isArray(res?.resources) ? res!.resources : [];
    return items.map((r) => {
      const x = r as Record<string, unknown>;
      return { uri: String(x.uri ?? ''), name: typeof x.name === 'string' ? x.name : undefined, description: typeof x.description === 'string' ? x.description : undefined, mimeType: typeof x.mimeType === 'string' ? x.mimeType : undefined };
    }).filter((r) => r.uri);
  }

  async listPrompts(serverId: string): Promise<McpPrompt[]> {
    const session = await this.session(serverId);
    const res = await this.rpc(session, 'prompts/list', {}).catch(() => undefined) as { prompts?: unknown[] } | undefined;
    const items = Array.isArray(res?.prompts) ? res!.prompts : [];
    return items.map((p) => {
      const x = p as Record<string, unknown>;
      return { name: String(x.name ?? ''), title: typeof x.title === 'string' ? x.title : undefined, description: typeof x.description === 'string' ? x.description : undefined, arguments: x.arguments };
    }).filter((p) => p.name);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string; details?: Record<string, unknown>; error?: string }> {
    try {
      const session = await this.session(serverId);
      const res = await this.rpc(session, 'tools/call', { name: toolName, arguments: args }) as { content?: unknown[]; isError?: boolean } | undefined;
      const output = extractContent(res?.content);
      if (res?.isError) return { success: false, output, error: output || 'mcp_tool_error' };
      return { success: true, output, details: { serverId, toolName } };
    } catch (e) {
      return { success: false, output: '', error: `mcp_call_failed: ${String(e instanceof Error ? e.message : e)}` };
    }
  }

  async readResource(serverId: string, resourceUri: string): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      const session = await this.session(serverId);
      const res = await this.rpc(session, 'resources/read', { uri: resourceUri }) as { contents?: unknown[] } | undefined;
      return { success: true, output: extractContent(res?.contents) };
    } catch (e) {
      return { success: false, output: '', error: String(e) };
    }
  }

  async getPrompt(serverId: string, promptName: string, args?: Record<string, unknown>): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      const session = await this.session(serverId);
      const res = await this.rpc(session, 'prompts/get', { name: promptName, arguments: args ?? {} }) as { messages?: unknown[] } | undefined;
      return { success: true, output: JSON.stringify(res?.messages ?? []) };
    } catch (e) {
      return { success: false, output: '', error: String(e) };
    }
  }

  async healthCheck(serverId: string): Promise<{ ok: boolean; message: string }> {
    try {
      await this.session(serverId);
      return { ok: true, message: 'connected' };
    } catch (e) {
      return { ok: false, message: String(e instanceof Error ? e.message : e) };
    }
  }

  /** Resolve (and lazily reconnect) a session for a server. */
  private async session(serverId: string): Promise<Session> {
    const existing = this.sessions.get(serverId);
    if (existing?.initialized) return existing;
    const config = await getMcpServer(serverId);
    if (!config) throw new Error(`mcp_server_not_found:${serverId}`);
    await this.connect(config);
    return this.sessions.get(serverId)!;
  }

  private headers(session: Session): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session.config.headers ?? {}),
      ...(session.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
    };
  }

  private async notify(session: Session, method: string): Promise<void> {
    await fetch(session.config.url!, {
      method: 'POST',
      headers: this.headers(session),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    });
  }

  private async rpc(session: Session, method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await fetch(session.config.url!, {
      method: 'POST',
      headers: this.headers(session),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`mcp_http_${res.status}: ${text.slice(0, 200)}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const message = contentType.includes('text/event-stream')
      ? parseSse(body, id)
      : (JSON.parse(body) as JsonRpcResponse);
    if (!message) throw new Error('mcp_no_response');
    if (message.error) throw new Error(`mcp_rpc_error ${message.error.code}: ${message.error.message}`);
    return message.result;
  }
}

/** Extract the matching JSON-RPC response from an SSE body. */
function parseSse(body: string, id: number | string): JsonRpcResponse | null {
  for (const block of body.split(/\n\n/)) {
    const dataLines = block.split(/\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join('\n')) as JsonRpcResponse;
      if (parsed.id === id || parsed.error || parsed.result !== undefined) return parsed;
    } catch { /* skip non-JSON events */ }
  }
  return null;
}

/** Flatten MCP content blocks into a plain-text output string. */
function extractContent(content: unknown[] | undefined): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string') parts.push(b.text);
    else if (typeof b.uri === 'string') parts.push(`[resource ${b.uri}]`);
    else parts.push(JSON.stringify(b));
  }
  return parts.join('\n');
}
