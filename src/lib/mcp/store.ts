import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { CreateMcpServerInput, McpServerConfig, McpToolSnapshot } from './types';

const SERVERS = 'mcp_servers';
const TOOLS = 'mcp_tool_snapshots';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toServer(row: RecordRow): McpServerConfig {
  return row as unknown as McpServerConfig;
}

function toTool(row: RecordRow): McpToolSnapshot {
  return row as unknown as McpToolSnapshot;
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServerConfig> {
  const now = new Date().toISOString();
  const server: McpServerConfig = {
    id: id('mcp'),
    providerId: input.providerId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description,
    transport: input.transport,
    command: input.command,
    args: input.args,
    env: input.env,
    url: input.url,
    headers: input.headers,
    authType: input.authType,
    enabled: input.enabled ?? true,
    trustLevel: input.trustLevel ?? 'untrusted',
    status: input.enabled === false ? 'disabled' : 'not_connected',
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
  await recordBackend().put(SERVERS, server as unknown as RecordRow);
  return server;
}

export async function getMcpServer(id: string): Promise<McpServerConfig | null> {
  const row = await recordBackend().get(SERVERS, id);
  return row ? toServer(row) : null;
}

export async function listMcpServers(filter: { userId: string; workspaceId?: string }): Promise<McpServerConfig[]> {
  const rows = await recordBackend().all(SERVERS);
  return rows
    .map(toServer)
    .filter((s) => s.userId === filter.userId)
    .filter((s) => !filter.workspaceId || !s.workspaceId || s.workspaceId === filter.workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateMcpServer(id: string, patch: Partial<Omit<McpServerConfig, 'id' | 'createdAt'>>): Promise<McpServerConfig | null> {
  const server = await getMcpServer(id);
  if (!server) return null;
  const updated = { ...server, ...patch, updatedAt: new Date().toISOString() };
  await recordBackend().put(SERVERS, updated as unknown as RecordRow);
  return updated;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const tools = await listMcpTools(id);
  await Promise.all(tools.map((tool) => recordBackend().delete(TOOLS, tool.id)));
  await recordBackend().delete(SERVERS, id);
}

export async function getMcpToolSnapshot(serverId: string, name: string): Promise<McpToolSnapshot | null> {
  const rows = await recordBackend().all(TOOLS);
  const found = rows.map(toTool).find((t) => t.serverId === serverId && t.name === name);
  return found ?? null;
}

export async function upsertMcpToolSnapshot(snapshot: McpToolSnapshot): Promise<McpToolSnapshot> {
  await recordBackend().put(TOOLS, snapshot as unknown as RecordRow);
  return snapshot;
}

export async function listMcpTools(serverId?: string): Promise<McpToolSnapshot[]> {
  const rows = await recordBackend().all(TOOLS);
  return rows
    .map(toTool)
    .filter((t) => !serverId || t.serverId === serverId)
    .sort((a, b) => `${a.serverId}:${a.name}`.localeCompare(`${b.serverId}:${b.name}`));
}

export async function setMcpToolApproval(id: string, patch: { approved?: boolean; enabled?: boolean }): Promise<McpToolSnapshot | null> {
  const row = await recordBackend().get(TOOLS, id);
  if (!row) return null;
  const updated = { ...toTool(row), ...patch };
  await recordBackend().put(TOOLS, updated as unknown as RecordRow);
  return updated;
}
