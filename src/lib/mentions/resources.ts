// Resolves the resources a user can @-mention. Pulls from the existing stores so
// mentions stay in sync with Skills, Connections, MCP, Memory and Workflows.

import type { MentionKind, MentionResource } from './types';
import { listBuilderSkills } from '../skills/builder/store';
import { listRichSkillManifests } from '../skills/runner';
import { listCatalogProviders } from '../connections/catalog';
import { listMcpServers, listMcpTools } from '../mcp/store';
import { listMemory } from '../memory/store';
import { listWorkflowTemplates } from '../workflows/templates/store';

export async function listMentionResources(opts: {
  userId: string;
  workspaceId?: string;
  kinds?: MentionKind[];
}): Promise<MentionResource[]> {
  const want = (k: MentionKind) => !opts.kinds || opts.kinds.includes(k);
  const out: MentionResource[] = [];

  if (want('skill')) {
    const custom = await listBuilderSkills({ userId: opts.userId, workspaceId: opts.workspaceId, includeSuggested: false }).catch(() => []);
    for (const s of custom) out.push({ kind: 'skill', refId: s.id, label: s.name, detail: s.enabled ? 'Created by you' : 'Disabled', available: s.enabled, metadata: { requiredConnections: s.requiredConnections } });
    for (const s of listRichSkillManifests()) out.push({ kind: 'skill', refId: s.id, label: s.name, detail: 'Built-in', available: true, metadata: { requiredConnections: s.requiredConnections } });
  }

  if (want('connection')) {
    for (const p of listCatalogProviders()) {
      out.push({ kind: 'connection', refId: p.id, label: p.name, detail: p.runtime === 'connected' ? 'Connected' : p.runtime === 'needs_setup' ? 'Needs setup' : p.runtime === 'available' ? 'MCP available' : 'Coming soon', available: p.runtime === 'connected', metadata: { runtime: p.runtime } });
    }
  }

  if (want('mcp')) {
    const servers = await listMcpServers({ userId: opts.userId, workspaceId: opts.workspaceId }).catch(() => []);
    for (const s of servers) {
      const tools = await listMcpTools(s.id).catch(() => []);
      const approved = tools.filter((t) => t.approved && t.enabled).length;
      out.push({ kind: 'mcp', refId: s.id, label: s.name, detail: `${s.status} · ${approved} approved tools`, available: s.status === 'connected' && approved > 0, metadata: { approvedTools: approved } });
    }
  }

  if (want('memory')) {
    const mems = await listMemory({ userId: opts.userId, workspaceId: opts.workspaceId, status: 'active' }).catch(() => []);
    for (const m of mems) out.push({ kind: 'memory', refId: m.id, label: m.title, detail: m.type, available: true, metadata: { content: m.content } });
  }

  if (want('workflow')) {
    const wfs = await listWorkflowTemplates({ userId: opts.userId, workspaceId: opts.workspaceId }).catch(() => []);
    for (const w of wfs.filter((x) => x.source !== 'builtin')) out.push({ kind: 'workflow', refId: w.id, label: w.name, detail: `${w.steps.length} steps`, available: true });
  }

  return out;
}
