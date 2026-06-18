// Generic, provider-agnostic MCP connection orchestration. Extracted from the
// Higgsfield flow so any catalog provider with a remote MCP server can connect
// through the same pipeline: ensure a server config, run a real MCP connect +
// tools/list, scan the discovered tools, and surface an honest state. Only
// enabled+approved tools reach the unified registry (via registry-bridge).
//
// Auth tokens never leak: connection failures that look like auth are reported as
// `auth_required` and the raw error is not surfaced verbatim where it could carry
// a secret.

import { mcpClient } from './client';
import { discoverMcpTools } from './discovery';
import {
  createMcpServer, getMcpServer, listMcpServers, listMcpTools, updateMcpServer,
} from './store';
import type { McpServerConfig, McpToolSnapshot } from './types';

export interface McpProviderCtx {
  userId: string;
  workspaceId?: string;
}

export type McpProviderState =
  | 'not_configured'
  | 'ready_to_inspect'
  | 'auth_required'
  | 'connected'
  | 'review_tools'
  | 'ready'
  | 'error';

export interface McpProviderStatus {
  state: McpProviderState;
  server?: McpServerConfig;
  tools: McpToolSnapshot[];
  message: string;
}

/** The remote (streamable_http) MCP server this user has for `providerId`, if any. */
export async function getMcpProviderServer(
  providerId: string,
  ctx: McpProviderCtx,
): Promise<McpServerConfig | undefined> {
  const servers = await listMcpServers({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  return servers.find((s) => s.providerId === providerId && s.transport === 'streamable_http');
}

async function ensureRemoteServer(
  providerId: string,
  name: string,
  ctx: McpProviderCtx,
  url: string,
): Promise<McpServerConfig> {
  const existing = await getMcpProviderServer(providerId, ctx);
  if (existing) {
    if (url && existing.url !== url) return (await updateMcpServer(existing.id, { url }))!;
    return existing;
  }
  return createMcpServer({
    providerId,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name: `${name} (MCP)`,
    description: `${name} via remote MCP server`,
    transport: 'streamable_http',
    url,
    authType: 'oauth2',
    // Remote servers are untrusted until the user reviews their tools.
    trustLevel: 'untrusted',
    metadata: { connectionKind: 'remote' },
  });
}

function summarize(server: McpServerConfig, tools: McpToolSnapshot[], connectedMsg: string): McpProviderStatus {
  if (tools.length === 0) return { state: 'connected', server, tools, message: `${connectedMsg} No tools discovered yet.` };
  const anyApproved = tools.some((t) => t.approved && t.enabled);
  return anyApproved
    ? { state: 'ready', server, tools, message: `${connectedMsg} ${tools.filter((t) => t.approved).length} tool(s) approved.` }
    : { state: 'review_tools', server, tools, message: `${connectedMsg} Review ${tools.length} discovered tool(s).` };
}

/** Save a remote MCP URL without connecting (card shows "Ready to inspect"). */
export async function setMcpProviderUrl(
  providerId: string,
  name: string,
  url: string,
  ctx: McpProviderCtx,
): Promise<McpServerConfig> {
  return ensureRemoteServer(providerId, name, ctx, url.trim());
}

/** Connect a provider via a remote Streamable HTTP MCP server. Never fakes connected. */
export async function connectMcpProvider(
  providerId: string,
  name: string,
  url: string,
  ctx: McpProviderCtx,
): Promise<McpProviderStatus> {
  const server = await ensureRemoteServer(providerId, name, ctx, url.trim());
  await updateMcpServer(server.id, { status: 'connecting', lastError: undefined });
  try {
    await mcpClient().connect((await getMcpServer(server.id))!);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/40[13]|unauth|www-authenticate|auth/i.test(msg)) {
      await updateMcpServer(server.id, { status: 'auth_required' });
      return { state: 'auth_required', server: (await getMcpServer(server.id))!, tools: [], message: `Sign in required for this ${name} MCP server.` };
    }
    await updateMcpServer(server.id, { status: 'error', lastError: msg });
    return { state: 'error', server: (await getMcpServer(server.id))!, tools: [], message: msg };
  }
  await discoverMcpTools(server.id);
  const tools = await listMcpTools(server.id);
  await updateMcpServer(server.id, { status: 'connected', lastConnectedAt: new Date().toISOString() });
  return summarize((await getMcpServer(server.id))!, tools, `Connected to ${name} MCP server.`);
}

export async function disconnectMcpProvider(serverId: string): Promise<void> {
  await mcpClient().disconnect(serverId).catch(() => undefined);
  await updateMcpServer(serverId, { status: 'not_connected' });
}

/** Current state for a provider's remote MCP server (no network calls). */
export async function mcpProviderState(providerId: string, ctx: McpProviderCtx): Promise<McpProviderStatus> {
  const server = await getMcpProviderServer(providerId, ctx);
  if (!server) return { state: 'not_configured', tools: [], message: 'Add an MCP server URL to connect.' };
  const tools = await listMcpTools(server.id);
  if (server.status === 'auth_required') return { state: 'auth_required', server, tools, message: 'Sign in required.' };
  if (server.status === 'error') return { state: 'error', server, tools, message: server.lastError ?? 'Connection error.' };
  if (server.status !== 'connected') return { state: 'ready_to_inspect', server, tools, message: 'Ready to inspect.' };
  return summarize(server, tools, 'Connected.');
}
