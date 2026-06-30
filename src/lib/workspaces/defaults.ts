import type { CreateWorkspaceInput, Workspace, WorkspaceKind } from './types';

/** Stable id used for the auto-created default workspace of a user. */
export function defaultWorkspaceId(userId: string): string {
  return `ws-default-${userId.slice(0, 12) || 'local'}`;
}

/**
 * The workspace every user gets on first run, so existing tasks keep working
 * even before anyone visits the Workspaces page. Personal kind, full local
 * access, semi autonomy — i.e. today's behavior.
 */
export function makeDefaultWorkspace(userId: string, now = new Date().toISOString()): Workspace {
  return {
    id: defaultWorkspaceId(userId),
    userId,
    name: 'Personal',
    description: 'Your default workspace. The agent works here when no other workspace is selected.',
    kind: 'personal',
    rootPaths: [],
    connectedProviderIds: [],
    enabledSkillIds: [],
    memoryScope: 'workspace',
    autonomyMode: 'semi',
    skillLearningConfig: { autoLearnLowRisk: true },
    createdAt: now,
    updatedAt: now,
  };
}

/** Suggested starter workspaces offered in onboarding / the Workspaces page. */
export const WORKSPACE_TEMPLATES: Array<{
  name: string;
  kind: WorkspaceKind;
  description: string;
}> = [
  { name: 'Personal', kind: 'personal', description: 'Day-to-day personal work.' },
  { name: 'Company', kind: 'company', description: 'Your own company operations.' },
  { name: 'Client', kind: 'client', description: 'Work delivered for a specific client.' },
  { name: 'Development', kind: 'project', description: 'A software project / repository.' },
  { name: 'Marketing', kind: 'project', description: 'Campaigns, content and reporting.' },
  { name: 'Operations', kind: 'project', description: 'Internal ops, admin and finance.' },
];

export function normalizeCreateInput(input: CreateWorkspaceInput, now: string): Workspace {
  return {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    name: input.name.trim() || 'Untitled workspace',
    description: input.description?.trim() || undefined,
    kind: input.kind ?? 'custom',
    rootPaths: input.rootPaths ?? [],
    connectedProviderIds: input.connectedProviderIds ?? [],
    enabledSkillIds: input.enabledSkillIds ?? [],
    memoryScope: 'workspace',
    autonomyMode: input.autonomyMode ?? 'semi',
    skillLearningConfig: { autoLearnLowRisk: true },
    defaultModelId: input.defaultModelId,
    createdAt: now,
    updatedAt: now,
  };
}
