import type { UnifiedTool } from '../tools/unified-registry';
import { listMcpServers, listMcpTools } from './store';

export async function listMcpUnifiedTools(filter: { userId: string; workspaceId?: string }): Promise<UnifiedTool[]> {
  const servers = await listMcpServers(filter);
  const serverIds = new Set(servers.filter((s) => s.enabled && s.status !== 'disabled').map((s) => s.id));
  const tools = await listMcpTools();
  return tools
    .filter((t) => serverIds.has(t.serverId))
    .filter((t) => t.enabled && t.approved)
    .map((t) => ({
      id: `mcp:${t.serverId}:${t.name}`,
      source: 'mcp',
      sourceId: t.serverId,
      name: t.name,
      displayName: t.title ?? t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      category: 'connections',
      risk: t.risk,
      enabled: t.enabled,
      workspaceIds: servers.find((s) => s.id === t.serverId)?.workspaceId ? [servers.find((s) => s.id === t.serverId)!.workspaceId!] : undefined,
      approvalRequired: ['external_write', 'external_send', 'destructive', 'credential_access', 'process_exec'].includes(t.risk),
      metadata: { metadataHash: t.metadataHash, flags: t.flags },
    }));
}
