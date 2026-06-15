// Workspace types — the main customization boundary of the Larund Coworker Core.
//
// A workspace bundles the local/remote roots, connections, skills, memory scope,
// autonomy and default model that shape how the agent behaves for one context
// (Personal, a Company, a Client, a Project, …). Switching workspace re-shapes
// the agent's system prompt and the surfaces it is allowed to touch.

export type WorkspaceKind = 'personal' | 'company' | 'client' | 'project' | 'custom';
export type AutonomyMode = 'manual' | 'semi' | 'full';
export type MemoryScope = 'workspace';

export type WorkspaceRootKind =
  | 'local_folder'
  | 'github_repo'
  | 'google_drive_folder'
  | 'notion_page'
  | 'url'
  | 'custom';

export interface WorkspaceRoot {
  id: string;
  kind: WorkspaceRootKind;
  label: string;
  uri: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  description?: string;
  kind: WorkspaceKind;
  rootPaths: WorkspaceRoot[];
  connectedProviderIds: string[];
  enabledSkillIds: string[];
  memoryScope: MemoryScope;
  autonomyMode: AutonomyMode;
  defaultModelId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateWorkspaceInput {
  userId: string;
  name: string;
  description?: string;
  kind?: WorkspaceKind;
  rootPaths?: WorkspaceRoot[];
  connectedProviderIds?: string[];
  enabledSkillIds?: string[];
  autonomyMode?: AutonomyMode;
  defaultModelId?: string;
}

export type WorkspacePatch = Partial<
  Omit<Workspace, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'memoryScope'>
>;
