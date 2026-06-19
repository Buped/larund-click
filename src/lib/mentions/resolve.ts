import type { DocumentReference } from '../references/types';
import type { ReferencedContext } from './types';
import { getApp, appStatus } from '../apps/store';
import { getBrowserProfile, DEFAULT_BROWSER_PROFILE } from '../browser/profiles';
import { loadFullSkillPackage, renderSkillPackageForAgent } from '../skills/packages/runtime';
import { listCatalogProviders } from '../connections/catalog';
import { getMcpServer, listMcpTools } from '../mcp/store';
import { getMemory } from '../memory/store';
import { getWorkflowTemplate, renderWorkflowPrompt } from '../workflows/templates/store';

export interface ResolvedMentionContext {
  promptBlock: string;
  blockers: string[];
  documentReferences: DocumentReference[];
}

export async function resolveReferencedContext(args: {
  references: ReferencedContext[];
  userId: string;
  workspaceId?: string;
  workflowDepth?: number;
  workflowStack?: string[];
}): Promise<ResolvedMentionContext> {
  const lines: string[] = [];
  const blockers: string[] = [];
  const documentReferences: DocumentReference[] = [];
  const depth = args.workflowDepth ?? 0;
  const stack = args.workflowStack ?? [];

  for (const ref of args.references) {
    if (ref.kind === 'file' || ref.kind === 'folder') {
      documentReferences.push(toDocumentReference(ref));
      continue;
    }

    if (ref.kind === 'app') {
      const app = getApp(ref.refId);
      if (!app) { blockers.push(`Referenced app "${ref.label}" was not found.`); continue; }
      const status = appStatus(app);
      const browser = getBrowserProfile(app.preferredBrowserId)?.label ?? DEFAULT_BROWSER_PROFILE.label;
      // SAFE metadata only — never the password or any raw secret.
      lines.push([
        `## App: ${app.label}`,
        app.domain ? `domain: ${app.domain}` : undefined,
        app.homeUrl ? `homeUrl: ${app.homeUrl}` : undefined,
        app.loginUrl ? `loginUrl: ${app.loginUrl}` : undefined,
        `preferredBrowser: ${browser}`,
        `credential: ${app.credentialId ? 'saved' : 'none'}`,
        app.username ? `account: ${app.username}` : undefined,
        app.notes ? `notes: ${app.notes}` : undefined,
        app.usageHints ? `usage hints: ${app.usageHints}` : undefined,
        `usage: To act in this app, open ${app.loginUrl || app.homeUrl || app.domain} with browser_profile_id "${app.preferredBrowserId ?? DEFAULT_BROWSER_PROFILE.id}". If login is required, call browser.login with app_id "${app.id}" (it fills the saved password automatically). Never ask the model for the password.`,
      ].filter(Boolean).join('\n'));
      if (status !== 'ready') blockers.push(`App "${app.label}" ${status === 'needs_password' ? 'has no saved password yet' : 'needs setup'} — login may require manual help.`);
      continue;
    }

    if (ref.kind === 'skill') {
      const skill = await loadFullSkillPackage(ref.refId, { userId: args.userId, workspaceId: args.workspaceId });
      if (!skill) { blockers.push(`Referenced skill "${ref.label}" was not found.`); continue; }
      if (!skill.enabled) { blockers.push(`Referenced skill "${skill.name}" is disabled.`); continue; }
      lines.push(renderSkillPackageForAgent(skill));
      continue;
    }

    if (ref.kind === 'connection') {
      const provider = listCatalogProviders().find((p) => p.id === ref.refId);
      if (!provider) { blockers.push(`Referenced connection "${ref.label}" was not found.`); continue; }
      if (provider.runtime !== 'connected') {
        blockers.push(`Connection "${provider.name}" needs setup before this task can use it.`);
      }
      lines.push([
        `## Connection: ${provider.name}`,
        `id: ${provider.id}`,
        `status: ${provider.runtime}`,
        `category: ${provider.category}`,
        `risk defaults: ${provider.status}`,
      ].join('\n'));
      continue;
    }

    if (ref.kind === 'mcp') {
      const server = await getMcpServer(ref.refId);
      if (!server) { blockers.push(`Referenced MCP server "${ref.label}" was not found.`); continue; }
      const tools = await listMcpTools(server.id).catch(() => []);
      const approved = tools.filter((t) => t.approved && t.enabled);
      if (server.status !== 'connected') blockers.push(`MCP server "${server.name}" is ${server.status}.`);
      if (approved.length === 0) blockers.push(`MCP server "${server.name}" has no approved enabled tools.`);
      lines.push([
        `## MCP server: ${server.name}`,
        `id: ${server.id}`,
        `status: ${server.status}`,
        `trust: ${server.trustLevel}`,
        `approved tools: ${approved.map((t) => t.name).join(', ') || 'none'}`,
      ].join('\n'));
      continue;
    }

    if (ref.kind === 'memory') {
      const memory = await getMemory(ref.refId);
      if (!memory || memory.status !== 'active') { blockers.push(`Referenced memory "${ref.label}" is missing or inactive.`); continue; }
      lines.push([
        `## Memory: ${memory.title}`,
        `scope: ${memory.scope}`,
        `type: ${memory.type}`,
        memory.content,
      ].join('\n'));
      continue;
    }

    if (ref.kind === 'workflow') {
      if (depth >= 3) { blockers.push(`Workflow reference depth exceeded while resolving "${ref.label}".`); continue; }
      if (stack.includes(ref.refId)) { blockers.push(`Workflow cycle detected: ${[...stack, ref.refId].join(' -> ')}`); continue; }
      const workflow = await getWorkflowTemplate(ref.refId, args.userId);
      if (!workflow) { blockers.push(`Referenced workflow "${ref.label}" was not found.`); continue; }
      lines.push(renderWorkflowPrompt(workflow));
    }
  }

  return {
    promptBlock: lines.length ? `## Explicit referenced context\n${lines.join('\n\n')}` : '',
    blockers,
    documentReferences,
  };
}

function toDocumentReference(ref: ReferencedContext): DocumentReference {
  const embedded = ref.metadata?.documentReference;
  if (embedded && typeof embedded === 'object') return embedded as DocumentReference;
  return {
    id: ref.id,
    kind: ref.kind === 'folder' ? 'folder' : 'file',
    label: ref.label,
    path: ref.refId,
    source: 'user_reference',
  };
}
