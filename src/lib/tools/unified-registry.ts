import type { ToolCategory, ToolRisk } from './types';
import { TOOL_CATALOG } from './registry';
import { ALL_MANIFESTS } from '../connections/registry';
import { listMcpUnifiedTools } from '../mcp/registry-bridge';
import { listCustomApiConnections, listCustomApiTools } from '../custom-api/store';

export interface UnifiedTool {
  id: string;
  source: 'builtin' | 'connection' | 'mcp' | 'custom_api' | 'workflow' | 'skill';
  sourceId?: string;
  name: string;
  displayName: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  category: ToolCategory;
  risk: ToolRisk;
  enabled: boolean;
  workspaceIds?: string[];
  approvalRequired: boolean;
  metadata?: Record<string, unknown>;
}

const APPROVAL_RISKS: ToolRisk[] = ['external_write', 'external_send', 'destructive', 'credential_access', 'process_exec'];

export async function listUnifiedTools(filter: {
  userId: string;
  workspaceId?: string;
  includeDisabled?: boolean;
  sources?: UnifiedTool['source'][];
}): Promise<UnifiedTool[]> {
  const all = [
    ...listBuiltinUnifiedTools(),
    ...listConnectionUnifiedTools(),
    ...(await listMcpUnifiedTools(filter)),
    ...(await listCustomApiUnifiedTools(filter)),
  ];
  return all
    .filter((tool) => !filter.sources || filter.sources.includes(tool.source))
    .filter((tool) => filter.includeDisabled || tool.enabled)
    .filter((tool) => !filter.workspaceId || !tool.workspaceIds || tool.workspaceIds.includes(filter.workspaceId))
    .sort((a, b) => `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`));
}

export function listBuiltinUnifiedTools(): UnifiedTool[] {
  return TOOL_CATALOG.map((tool) => ({
    id: `builtin:${tool.name}`,
    source: 'builtin',
    name: tool.name,
    displayName: tool.name,
    description: tool.description,
    category: tool.category,
    risk: tool.baseRisk,
    enabled: true,
    approvalRequired: APPROVAL_RISKS.includes(tool.baseRisk),
  }));
}

export function listConnectionUnifiedTools(): UnifiedTool[] {
  return ALL_MANIFESTS.flatMap((manifest) =>
    manifest.tools.map((tool) => ({
      id: `connection:${manifest.id}:${tool.name}`,
      source: 'connection' as const,
      sourceId: manifest.id,
      name: tool.name,
      displayName: tool.name,
      description: tool.description,
      category: 'connections' as ToolCategory,
      risk: tool.risk,
      enabled: !manifest.scaffold,
      approvalRequired: APPROVAL_RISKS.includes(tool.risk),
      metadata: { authType: manifest.auth.type },
    })),
  );
}

async function listCustomApiUnifiedTools(filter: { userId: string; workspaceId?: string }): Promise<UnifiedTool[]> {
  const connections = await listCustomApiConnections(filter);
  const tools = await Promise.all(connections.map(async (connection) => ({ connection, tools: await listCustomApiTools(connection.id) })));
  return tools.flatMap(({ connection, tools }) =>
    tools.map((tool) => ({
      id: `custom_api:${connection.id}:${tool.id}`,
      source: 'custom_api' as const,
      sourceId: connection.id,
      name: tool.name,
      displayName: `${connection.name}: ${tool.name}`,
      description: tool.description,
      inputSchema: { query: tool.querySchema, body: tool.bodySchema },
      category: 'connections' as ToolCategory,
      risk: tool.risk,
      enabled: connection.enabled && tool.enabled,
      workspaceIds: connection.workspaceId ? [connection.workspaceId] : undefined,
      approvalRequired: APPROVAL_RISKS.includes(tool.risk),
      metadata: { method: tool.method, pathTemplate: tool.pathTemplate },
    })),
  );
}

export async function promptVisibleToolSummary(filter: { userId: string; workspaceId?: string; task?: string; limit?: number }): Promise<string> {
  const tools = await listUnifiedTools(filter);
  const selected = filter.task
    ? tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(filter.task!.toLowerCase().split(/\s+/)[0] ?? '')).slice(0, filter.limit ?? 80)
    : tools.slice(0, filter.limit ?? 80);
  return selected.map((tool) => `- ${tool.id}: ${tool.description} [${tool.risk}${tool.approvalRequired ? ', approval' : ''}]`).join('\n');
}
