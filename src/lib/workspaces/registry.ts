// Workspace registry helpers — pure functions that summarize a workspace for the
// agent system prompt. Kept separate from the store so they are trivially
// testable and never touch persistence.

import type { Workspace } from './types';

/** Human label for an autonomy mode, used in the prompt and UI. */
export function autonomyLabel(mode: Workspace['autonomyMode']): string {
  switch (mode) {
    case 'manual':
      return 'manual (ask before every write/external action)';
    case 'full':
      return 'full (act autonomously within risk policy)';
    case 'semi':
    default:
      return 'semi (auto for low-risk, approval for risky/external actions)';
  }
}

export interface WorkspaceSummaryInput {
  enabledSkillNames?: string[];
  enabledConnectionNames?: string[];
}

/**
 * Compact workspace summary injected into the system prompt. Deliberately small:
 * a name, roots, enabled connections/skills and autonomy — never raw data.
 */
export function renderWorkspaceSummary(ws: Workspace, extra: WorkspaceSummaryInput = {}): string {
  const lines: string[] = [];
  lines.push(`Name: ${ws.name}${ws.kind ? ` (${ws.kind})` : ''}`);
  if (ws.description) lines.push(`Purpose: ${ws.description}`);

  const roots = ws.rootPaths.filter((r) => r.enabled);
  if (roots.length) {
    lines.push(
      `Roots: ${roots.map((r) => `${r.label} [${r.kind}] ${r.uri}`).join('; ')}`,
    );
  } else {
    lines.push('Roots: (none configured — operate from the user-provided paths)');
  }

  const conns = extra.enabledConnectionNames ?? ws.connectedProviderIds;
  lines.push(`Connections: ${conns.length ? conns.join(', ') : '(none enabled)'}`);

  const skills = extra.enabledSkillNames ?? ws.enabledSkillIds;
  lines.push(`Skills enabled: ${skills.length ? skills.join(', ') : '(workspace default set)'}`);

  lines.push(`Autonomy: ${autonomyLabel(ws.autonomyMode)}`);
  if (ws.defaultModelId) lines.push(`Preferred model: ${ws.defaultModelId}`);

  return lines.join('\n');
}

/** Pick the primary local root, if any — used as the agent's working dir. */
export function primaryLocalRoot(ws: Workspace): string | undefined {
  const root = ws.rootPaths.find((r) => r.enabled && r.kind === 'local_folder');
  return root?.uri;
}
