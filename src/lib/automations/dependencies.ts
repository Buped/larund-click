// Checks whether an automation's referenced resources are ready. Blockers prevent
// enabling/running; warnings are advisory. This is what powers the "Google Ads is
// not connected. Connect it before enabling this automation." UX.

import { invoke } from '@tauri-apps/api/core';
import type { Automation } from './types';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, referencedMcpIds } from './migrate';
import { listCatalogProviders } from '../connections/catalog';
import { isUsableConnectionRuntime, normalizeConnectionProviderId } from '../connections/provider-aliases';
import { listBuilderSkills } from '../skills/builder/store';
import { listRichSkillManifests } from '../skills/runner';
import { listMcpServers, listMcpTools } from '../mcp/store';
import type { DocumentReference } from '../references/types';
import type { ReferencedContext } from '../mentions/types';
import { getMemory } from '../memory/store';
import { getWorkflowTemplate } from '../workflows/templates/store';

export interface DependencyIssue {
  kind: 'connection' | 'skill' | 'mcp' | 'memory' | 'workflow' | 'file' | 'folder' | 'url' | 'trigger';
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
  const catalog = listCatalogProviders({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  for (const id of referencedConnectionIds(a)) {
    const providerId = normalizeConnectionProviderId(id);
    const p = catalog.find((x) => x.id === providerId);
    const label = p?.name ?? id;
    if (!p || !isUsableConnectionRuntime(p.runtime)) {
      blockers.push({ kind: 'connection', refId: providerId, label, message: `${label} is not connected. Connect it before enabling this automation.`, action: 'connect' });
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

  const allRefs = allReferencedContext(a);
  for (const ref of allRefs.filter((r) => r.kind === 'memory')) {
    const memory = await getMemory(ref.refId).catch(() => null);
    if (!memory) blockers.push({ kind: 'memory', refId: ref.refId, label: ref.label, message: `Referenced memory "${ref.label}" was not found.` });
    else if (memory.status !== 'active') warnings.push({ kind: 'memory', refId: ref.refId, label: ref.label, message: `Referenced memory "${memory.title}" is ${memory.status}.` });
  }

  for (const ref of allRefs.filter((r) => r.kind === 'workflow')) {
    const workflow = await getWorkflowTemplate(ref.refId, ctx.userId).catch(() => undefined);
    if (!workflow) blockers.push({ kind: 'workflow', refId: ref.refId, label: ref.label, message: `Referenced workflow "${ref.label}" was not found.` });
  }

  if (a.trigger.kind === 'folder_watch') {
    const path = a.trigger.path.trim();
    if (!path) {
      blockers.push({ kind: 'trigger', refId: 'folder_watch.path', label: 'Folder watch', message: 'Folder watch needs a folder path before this automation can run.' });
    } else {
      const result = await probePath(path);
      if (!result.ok) blockers.push({ kind: 'trigger', refId: path, label: 'Folder watch', message: `Folder watch path is not accessible: ${path}. ${result.message}` });
      else if (result.type === 'file') blockers.push({ kind: 'trigger', refId: path, label: 'Folder watch', message: `Folder watch path must be a folder, but this path is a file: ${path}.` });
    }
  }

  const fileRefs = allRefs.filter((r) => r.kind === 'file' || r.kind === 'folder');
  for (const ref of fileRefs) {
    const issueKind: 'file' | 'folder' = ref.kind === 'folder' ? 'folder' : 'file';
    const doc = mentionToDocumentReference(ref);
    if (doc.kind === 'url') {
      const url = doc.url ?? ref.refId;
      if (!isValidUrl(url)) blockers.push({ kind: 'url', refId: url, label: ref.label, message: `URL reference is invalid: ${url}` });
      continue;
    }
    const path = doc.path ?? ref.refId;
    if (!path) {
      blockers.push({ kind: issueKind, refId: ref.refId, label: ref.label, message: `Referenced ${issueKind} "${ref.label}" has no local path.` });
      continue;
    }
    const result = await probePath(path);
    if (!result.ok) {
      blockers.push({ kind: issueKind, refId: path, label: ref.label, message: `Referenced ${issueKind} is not accessible: ${path}. ${result.message}` });
    } else if (ref.kind === 'folder' && result.type === 'file') {
      blockers.push({ kind: 'folder', refId: path, label: ref.label, message: `Referenced folder "${ref.label}" points to a file: ${path}.` });
    } else if (ref.kind === 'file' && result.type === 'folder') {
      blockers.push({ kind: 'file', refId: path, label: ref.label, message: `Referenced file "${ref.label}" points to a folder: ${path}.` });
    }
  }

  return { blockers, warnings, ok: blockers.length === 0 };
}

function allReferencedContext(a: ReturnType<typeof normalizeAutomation>): ReferencedContext[] {
  const seen = new Set<string>();
  const refs = [...a.referencedContext, ...a.steps.flatMap((s) => s.referencedContext), ...a.setupPlan.steps.flatMap((s) => s.referencedContext)];
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.refId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mentionToDocumentReference(ref: ReferencedContext): DocumentReference {
  const doc = ref.metadata?.documentReference;
  if (doc && typeof doc === 'object') return doc as DocumentReference;
  return {
    id: ref.id,
    kind: ref.kind === 'folder' ? 'folder' : 'file',
    label: ref.label,
    path: ref.refId,
    source: 'user_reference',
  };
}

async function probePath(path: string): Promise<{ ok: boolean; type?: 'file' | 'folder'; message?: string }> {
  try {
    const raw = await invoke<string>('fs_metadata', { path });
    const parsed = JSON.parse(raw) as { is_dir?: boolean; is_file?: boolean };
    return { ok: true, type: parsed.is_dir ? 'folder' : parsed.is_file ? 'file' : undefined };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
