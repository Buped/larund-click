import { TOOL_CATALOG } from '../tools/registry';
import { mcpClient } from './client';
import { scanMcpTool } from './security-scanner';
import { getMcpServer, getMcpToolSnapshot, updateMcpServer, upsertMcpToolSnapshot } from './store';
import type { McpToolSnapshot } from './types';

export async function connectMcpServer(serverId: string): Promise<void> {
  const server = await getMcpServer(serverId);
  if (!server) throw new Error(`mcp_server_not_found:${serverId}`);
  await mcpClient().connect(server);
  await updateMcpServer(serverId, { status: 'connected', lastConnectedAt: new Date().toISOString() });
}

export async function discoverMcpTools(serverId: string): Promise<McpToolSnapshot[]> {
  const server = await getMcpServer(serverId);
  if (!server) throw new Error(`mcp_server_not_found:${serverId}`);
  const tools = await mcpClient().listTools(serverId);
  const now = new Date().toISOString();
  const snapshots: McpToolSnapshot[] = [];
  for (const tool of tools) {
    const previous = await getMcpToolSnapshot(serverId, tool.name);
    const scan = scanMcpTool({ tool, server, previous, trustedToolNames: TOOL_CATALOG.map((t) => t.name) });
    const snapshot: McpToolSnapshot = {
      id: previous?.id ?? `mcp-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      serverId,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      risk: scan.risk,
      flags: scan.flags,
      enabled: scan.enabled,
      approved: scan.approved,
      metadataHash: scan.metadataHash,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
      changedAt: previous && previous.metadataHash !== scan.metadataHash ? now : previous?.changedAt,
    };
    await upsertMcpToolSnapshot(snapshot);
    snapshots.push(snapshot);
  }
  return snapshots;
}
