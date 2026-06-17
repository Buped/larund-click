// Higgsfield connection orchestration. Two paths:
//   • CLI adapter (reliable first path): the user signs in with `higgsfield auth
//     login`; Larund detects the CLI, discovers the curated tool catalog, scans it,
//     and surfaces it for approval.
//   • Remote MCP: the user pastes HIGGSFIELD_MCP_URL; Larund runs a real MCP
//     initialize + tools/list. If the server needs auth we surface auth_required
//     and never fake a connection.
//
// Tokens never touch Larund: CLI auth is owned by the CLI; remote auth headers (if
// any) are stored opaquely and never logged.

import { mcpClient } from '../client';
import { discoverMcpTools } from '../discovery';
import {
  createMcpServer, getMcpServer, listMcpServers, listMcpTools, updateMcpServer, upsertMcpToolSnapshot,
} from '../store';
import type { McpServerConfig, McpToolSnapshot } from '../types';
import { HIGGSFIELD_TOOL_RISK } from './tools';
import { probeHiggsfieldCli, type HiggsfieldCliState } from './cli';

export const HIGGSFIELD_PROVIDER_ID = 'higgsfield';

export interface HiggsfieldCtx {
  userId: string;
  workspaceId?: string;
}

export type HiggsfieldState =
  | 'not_configured'
  | 'ready_to_inspect'
  | 'auth_required'
  | 'cli_not_installed'
  | 'connected'
  | 'review_tools'
  | 'ready'
  | 'error';

export interface HiggsfieldStatus {
  state: HiggsfieldState;
  server?: McpServerConfig;
  tools: McpToolSnapshot[];
  message: string;
}

function defaultMcpUrl(): string | undefined {
  // Read HIGGSFIELD_MCP_URL from env (no secret; a connector endpoint).
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = env?.HIGGSFIELD_MCP_URL ?? env?.VITE_HIGGSFIELD_MCP_URL;
  if (fromVite) return fromVite;
  try {
    const p = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    return p?.env?.HIGGSFIELD_MCP_URL;
  } catch { return undefined; }
}

/** The Higgsfield MCP server for this user (CLI adapter preferred, else remote). */
export async function getHiggsfieldServer(ctx: HiggsfieldCtx): Promise<McpServerConfig | undefined> {
  const servers = await listMcpServers({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  const mine = servers.filter((s) => s.providerId === HIGGSFIELD_PROVIDER_ID);
  return mine.find((s) => s.transport === 'cli_adapter') ?? mine[0];
}

async function ensureServer(ctx: HiggsfieldCtx, kind: 'cli' | 'remote', url?: string): Promise<McpServerConfig> {
  const existing = (await listMcpServers({ userId: ctx.userId, workspaceId: ctx.workspaceId }))
    .find((s) => s.providerId === HIGGSFIELD_PROVIDER_ID && (kind === 'cli' ? s.transport === 'cli_adapter' : s.transport === 'streamable_http'));
  if (existing) {
    if (url && existing.url !== url) return (await updateMcpServer(existing.id, { url }))!;
    return existing;
  }
  return createMcpServer({
    providerId: HIGGSFIELD_PROVIDER_ID,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name: kind === 'cli' ? 'Higgsfield (CLI)' : 'Higgsfield (MCP)',
    description: 'Higgsfield image/video/audio generation',
    transport: kind === 'cli' ? 'cli_adapter' : 'streamable_http',
    url: kind === 'remote' ? url : undefined,
    authType: kind === 'cli' ? 'cli_login' : 'oauth2',
    // CLI catalog is first-party and curated; remote servers are untrusted until reviewed.
    trustLevel: kind === 'cli' ? 'trusted' : 'untrusted',
    metadata: { connectionKind: kind },
  });
}

/** Re-derive tool risk from the curated catalog (overrides scanner heuristics for CLI tools). */
async function applyHiggsfieldRisk(serverId: string): Promise<McpToolSnapshot[]> {
  const tools = await listMcpTools(serverId);
  const out: McpToolSnapshot[] = [];
  for (const t of tools) {
    const risk = HIGGSFIELD_TOOL_RISK[t.name];
    const next = risk && risk !== t.risk ? { ...t, risk } : t;
    if (next !== t) await upsertMcpToolSnapshot(next);
    out.push(next);
  }
  return out;
}

const STATE_MESSAGE: Record<HiggsfieldCliState, string> = {
  not_installed: 'Higgsfield CLI is not installed.',
  auth_required: 'Sign in to Higgsfield: run `higgsfield auth login` in a terminal, then re-check.',
  ready: 'Higgsfield CLI is signed in.',
  error: 'Higgsfield CLI returned an error.',
};

/** Connect via the Higgsfield CLI: probe, then discover + scan tools. Never fakes connected. */
export async function connectHiggsfieldCli(ctx: HiggsfieldCtx): Promise<HiggsfieldStatus> {
  const server = await ensureServer(ctx, 'cli');
  await updateMcpServer(server.id, { status: 'connecting', lastError: undefined });
  const probe = await probeHiggsfieldCli();

  if (probe.state !== 'ready') {
    const status = probe.state === 'not_installed' ? 'not_connected' : probe.state === 'auth_required' ? 'auth_required' : 'error';
    await updateMcpServer(server.id, { status, lastError: probe.state === 'error' ? probe.message : undefined });
    return {
      state: probe.state === 'not_installed' ? 'cli_not_installed' : probe.state === 'auth_required' ? 'auth_required' : 'error',
      server: (await getMcpServer(server.id)) ?? server,
      tools: [],
      message: STATE_MESSAGE[probe.state],
    };
  }

  await mcpClient().connect((await getMcpServer(server.id))!);
  await discoverMcpTools(server.id);
  const tools = await applyHiggsfieldRisk(server.id);
  await updateMcpServer(server.id, { status: 'connected', lastConnectedAt: new Date().toISOString(), lastError: undefined });
  return summarize((await getMcpServer(server.id))!, tools, 'Connected to Higgsfield CLI.');
}

/** Connect via a remote Streamable HTTP MCP server. Surfaces auth_required honestly. */
export async function connectHiggsfieldRemote(url: string, ctx: HiggsfieldCtx): Promise<HiggsfieldStatus> {
  const server = await ensureServer(ctx, 'remote', url.trim());
  await updateMcpServer(server.id, { status: 'connecting', lastError: undefined });
  try {
    await mcpClient().connect((await getMcpServer(server.id))!);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/40[13]|unauth|www-authenticate|auth/i.test(msg)) {
      await updateMcpServer(server.id, { status: 'auth_required' });
      return { state: 'auth_required', server: (await getMcpServer(server.id))!, tools: [], message: 'Sign in required for this Higgsfield MCP server.' };
    }
    await updateMcpServer(server.id, { status: 'error', lastError: msg });
    return { state: 'error', server: (await getMcpServer(server.id))!, tools: [], message: msg };
  }
  await discoverMcpTools(server.id);
  const tools = await applyHiggsfieldRisk(server.id);
  await updateMcpServer(server.id, { status: 'connected', lastConnectedAt: new Date().toISOString() });
  return summarize((await getMcpServer(server.id))!, tools, 'Connected to Higgsfield MCP server.');
}

/** Save a remote MCP URL without connecting (so the card shows "Ready to inspect"). */
export async function setHiggsfieldMcpUrl(url: string, ctx: HiggsfieldCtx): Promise<McpServerConfig> {
  return ensureServer(ctx, 'remote', url.trim());
}

export async function disconnectHiggsfield(serverId: string): Promise<void> {
  await mcpClient().disconnect(serverId).catch(() => undefined);
  await updateMcpServer(serverId, { status: 'not_connected' });
}

function summarize(server: McpServerConfig, tools: McpToolSnapshot[], connectedMsg: string): HiggsfieldStatus {
  if (tools.length === 0) return { state: 'connected', server, tools, message: `${connectedMsg} No tools discovered yet.` };
  const anyApproved = tools.some((t) => t.approved && t.enabled);
  return anyApproved
    ? { state: 'ready', server, tools, message: `${connectedMsg} ${tools.filter((t) => t.approved).length} tool(s) approved.` }
    : { state: 'review_tools', server, tools, message: `${connectedMsg} Review ${tools.length} discovered tool(s).` };
}

/** Current Higgsfield connection status for the UI / runtime (no network calls). */
export async function higgsfieldConnectionState(ctx: HiggsfieldCtx): Promise<HiggsfieldStatus> {
  const server = await getHiggsfieldServer(ctx);
  if (!server) {
    return { state: 'not_configured', tools: [], message: defaultMcpUrl() ? 'Connect & inspect, or use the Higgsfield CLI.' : 'Add an MCP URL or use the Higgsfield CLI.' };
  }
  const tools = await listMcpTools(server.id);
  if (server.status === 'auth_required') return { state: 'auth_required', server, tools, message: 'Sign in to Higgsfield.' };
  if (server.status === 'error') return { state: 'error', server, tools, message: server.lastError ?? 'Connection error.' };
  if (server.status !== 'connected') return { state: 'ready_to_inspect', server, tools, message: 'Ready to inspect.' };
  return summarize(server, tools, 'Connected.');
}

export { defaultMcpUrl as higgsfieldDefaultMcpUrl };
