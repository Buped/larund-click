// Checks whether an automation's referenced resources are ready. Blockers prevent
// enabling/running; warnings are advisory. This is what powers the "Google Ads is
// not connected. Connect it before enabling this automation." UX.

import type { Automation } from './types';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, referencedMcpIds } from './migrate';
import { listCatalogProviders } from '../connections/catalog';
import { listBuilderSkills } from '../skills/builder/store';
import { listRichSkillManifests } from '../skills/runner';
import { listMcpServers, listMcpTools } from '../mcp/store';

export interface DependencyIssue {
  kind: 'connection' | 'skill' | 'mcp';
  refId: string;
  label: string;
  message: string;
  /** 'connection' issues offer a Connect action. */
  action?: 'connect' | 'approve' | 'enable';
}

export interface DependencyReport {
  blockers: DependencyIssue[];
  warnings: DependencyIssue[];
  ok: boolean;
}

export async function checkAutomationDependencies(
  automation: Automation,
  ctx: { userId: string; workspaceId?: string },
): Promise<DependencyReport> {
  const a = normalizeAutomation(automation);
  const blockers: DependencyIssue[] = [];
  const warnings: DependencyIssue[] = [];

  // Connections — must be connected.
  const catalog = listCatalogProviders();
  for (const id of referencedConnectionIds(a)) {
    const p = catalog.find((x) => x.id === id);
    const label = p?.name ?? id;
    if (!p || p.runtime !== 'connected') {
      blockers.push({ kind: 'connection', refId: id, label, message: `${label} is not connected. Connect it before enabling this automation.`, action: 'connect' });
    }
  }

  // Skills — must exist; warn if disabled.
  const skillIds = referencedSkillIds(a);
  if (skillIds.length) {
    const custom = await listBuilderSkills({ userId: ctx.userId, workspaceId: ctx.workspaceId, includeSuggested: true }).catch(() => []);
    const bundled = listRichSkillManifests();
    for (const id of skillIds) {
      const c = custom.find((s) => s.id === id);
      const b = bundled.find((s) => s.id === id);
      if (!c && !b) warnings.push({ kind: 'skill', refId: id, label: id, message: `Referenced skill "${id}" was not found.` });
      else if (c && !c.enabled) warnings.push({ kind: 'skill', refId: id, label: c.name, message: `Skill "${c.name}" is disabled.`, action: 'enable' });
    }
  }

  // MCP — server connected and at least one approved tool.
  const mcpIds = referencedMcpIds(a);
  if (mcpIds.length) {
    const servers = await listMcpServers({ userId: ctx.userId, workspaceId: ctx.workspaceId }).catch(() => []);
    for (const id of mcpIds) {
      const server = servers.find((s) => s.id === id);
      if (!server) { blockers.push({ kind: 'mcp', refId: id, label: id, message: `MCP server "${id}" was not found.` }); continue; }
      const tools = await listMcpTools(id).catch(() => []);
      const approved = tools.filter((t) => t.approved && t.enabled);
      if (approved.length === 0) {
        warnings.push({ kind: 'mcp', refId: id, label: server.name, message: `MCP server "${server.name}" has no approved tools. Approve tools before use.`, action: 'approve' });
      }
    }
  }

  return { blockers, warnings, ok: blockers.length === 0 };
}
