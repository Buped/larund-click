import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { CreateCustomApiConnectionInput, CreateCustomApiToolInput, CustomApiConnection, CustomApiTool } from './types';
import { classifyCustomApiTool } from './risk';

const CONNECTIONS = 'custom_api_connections';
const TOOLS = 'custom_api_tools';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toConnection(row: RecordRow): CustomApiConnection {
  return row as unknown as CustomApiConnection;
}

function toTool(row: RecordRow): CustomApiTool {
  return row as unknown as CustomApiTool;
}

export async function createCustomApiConnection(input: CreateCustomApiConnectionInput): Promise<CustomApiConnection> {
  const now = new Date().toISOString();
  const connection: CustomApiConnection = {
    id: id('custom-api'),
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name,
    baseUrl: input.baseUrl,
    authType: input.authType ?? 'none',
    secretRef: input.secretRef,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await recordBackend().put(CONNECTIONS, connection as unknown as RecordRow);
  return connection;
}

export async function getCustomApiConnection(id: string): Promise<CustomApiConnection | null> {
  const row = await recordBackend().get(CONNECTIONS, id);
  return row ? toConnection(row) : null;
}

export async function listCustomApiConnections(filter: { userId: string; workspaceId?: string }): Promise<CustomApiConnection[]> {
  const rows = await recordBackend().all(CONNECTIONS);
  return rows
    .map(toConnection)
    .filter((c) => c.userId === filter.userId)
    .filter((c) => !filter.workspaceId || !c.workspaceId || c.workspaceId === filter.workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createCustomApiTool(input: CreateCustomApiToolInput): Promise<CustomApiTool> {
  const now = new Date().toISOString();
  const tool: CustomApiTool = {
    id: id('custom-tool'),
    connectionId: input.connectionId,
    name: input.name,
    description: input.description,
    method: input.method,
    pathTemplate: input.pathTemplate,
    querySchema: input.querySchema,
    bodySchema: input.bodySchema,
    headers: input.headers,
    risk: input.risk ?? classifyCustomApiTool(input),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await recordBackend().put(TOOLS, tool as unknown as RecordRow);
  return tool;
}

export async function listCustomApiTools(connectionId?: string): Promise<CustomApiTool[]> {
  const rows = await recordBackend().all(TOOLS);
  return rows
    .map(toTool)
    .filter((t) => !connectionId || t.connectionId === connectionId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setCustomApiToolEnabled(id: string, enabled: boolean): Promise<CustomApiTool | null> {
  const row = await recordBackend().get(TOOLS, id);
  if (!row) return null;
  const tool = { ...toTool(row), enabled, updatedAt: new Date().toISOString() };
  await recordBackend().put(TOOLS, tool as unknown as RecordRow);
  return tool;
}
