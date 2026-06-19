// Resolves the resources a user can @-mention. Pulls from the existing stores so
// mentions stay in sync with Skills, Connections, MCP, Memory and Workflows.

import type { MentionKind, MentionResource } from './types';
import { listApps, appStatus } from '../apps/store';
import { getBrowserProfile, DEFAULT_BROWSER_PROFILE } from '../browser/profiles';
import { listSkillPackages } from '../skills/packages/store';
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

  if (want('app')) {
    for (const app of listApps()) {
      const status = appStatus(app);
      const browser = getBrowserProfile(app.preferredBrowserId)?.label ?? DEFAULT_BROWSER_PROFILE.label;
      const detail = `${app.domain || 'no domain'} · ${browser} · ${status === 'ready' ? 'ready' : status === 'needs_password' ? 'needs password' : 'needs setup'}`;
      out.push({
        kind: 'app',
        refId: app.id,
        label: app.label,
        detail,
        available: status === 'ready',
        metadata: { domain: app.domain, status, preferredBrowserId: app.preferredBrowserId },
      });
    }
  }

  if (want('skill')) {
    const skills = await listSkillPackages({ userId: opts.userId, workspaceId: opts.workspaceId, includeSuggested: false }).catch(() => []);
    for (const s of skills) {
      out.push({
        kind: 'skill',
        refId: s.id,
        label: s.name,
        detail: s.source === 'built_in' ? 'Built-in skill' : s.enabled ? 'Created by you' : 'Disabled',
        available: s.enabled,
        metadata: { requiredConnections: s.requiredConnections, source: s.source, riskLevel: s.riskLevel },
      });
    }
  }

  if (want('connection')) {
    for (const p of listCatalogProviders()) {
      const detail = p.runtime === 'connected' ? 'Connected'
        : p.runtime === 'dev_shortcut_active' ? 'Dev shortcut active'
        : p.runtime === 'ready_to_connect' ? 'Ready to connect'
        : p.runtime === 'api_key_required' ? 'Add API key'
        : p.runtime === 'developer_setup_missing' ? 'Developer setup missing'
        : p.runtime === 'needs_reconnect' ? 'Needs reconnect'
        : p.runtime === 'mcp_available' ? 'MCP available'
        : 'Coming soon';
      out.push({ kind: 'connection', refId: p.id, label: p.name, detail, available: p.runtime === 'connected' || p.runtime === 'dev_shortcut_active', metadata: { runtime: p.runtime } });
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
    for (const w of wfs) out.push({ kind: 'workflow', refId: w.id, label: w.name, detail: `${w.steps.length} steps`, available: true, metadata: { source: w.source } });
  }

  return out;
}
