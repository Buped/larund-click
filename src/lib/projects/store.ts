import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import type { CreateProjectInput, Project, ProjectKind, ProjectPatch, ProjectRole, ProjectStatus } from './types';

const PROJECTS_TABLE = 'larund_projects';
const PREFERENCES_TABLE = 'larund_user_project_preferences';
const MEMBERS_TABLE = 'larund_project_members';

type ProjectRow = {
  id: string;
  owner_user_id: string;
  created_by_user_id?: string | null;
  name: string;
  description?: string | null;
  kind: ProjectKind;
  status: ProjectStatus;
  color?: string | null;
  icon?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  last_opened_at?: string | null;
};

type PreferenceRow = {
  user_id: string;
  active_project_id?: string | null;
  updated_at?: string | null;
};

export interface ProjectBackend {
  listProjects(userId: string): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | null>;
  createProject(userId: string, input: CreateProjectInput): Promise<Project>;
  updateProject(projectId: string, patch: ProjectPatch): Promise<Project>;
  archiveProject(projectId: string): Promise<void>;
  getActiveProjectId(userId: string): Promise<string | null>;
  setActiveProjectId(userId: string, projectId: string): Promise<void>;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id ?? null,
    name: row.name,
    description: row.description ?? '',
    kind: row.kind,
    status: row.status,
    color: row.color ?? null,
    icon: row.icon ?? 'folder',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
  };
}

function insertFor(userId: string, input: CreateProjectInput): Partial<ProjectRow> {
  return {
    owner_user_id: userId,
    created_by_user_id: userId,
    name: input.name.trim() || 'Untitled Project',
    description: input.description?.trim() ?? '',
    kind: input.kind ?? 'project',
    status: 'active',
    color: input.color ?? null,
    icon: input.icon ?? 'folder',
  };
}

function updateFor(patch: ProjectPatch): Partial<ProjectRow> {
  const row: Partial<ProjectRow> = {};
  if (patch.name !== undefined) row.name = patch.name.trim() || 'Untitled Project';
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.icon !== undefined) row.icon = patch.icon;
  if (patch.status !== undefined) {
    row.status = patch.status;
    row.archived_at = patch.status === 'archived' ? new Date().toISOString() : null;
  }
  return row;
}

export class SupabaseProjectBackend implements ProjectBackend {
  async listProjects(userId: string): Promise<Project[]> {
    // Membership is the single source of truth for "my projects" — an owner
    // always has an owner member row (enforced by trigger + backfill), so this
    // returns both owned and joined projects with the caller's role attached.
    const { data: memberRows, error: memberErr } = await supabase
      .from(MEMBERS_TABLE)
      .select('project_id, role')
      .eq('user_id', userId);
    if (memberErr) throw new Error(memberErr.message);
    const roleById = new Map<string, ProjectRole>(
      ((memberRows ?? []) as Array<{ project_id: string; role: ProjectRole }>).map((m) => [m.project_id, m.role]),
    );
    if (roleById.size === 0) return [];

    const { data, error } = await supabase
      .from(PROJECTS_TABLE)
      .select('*')
      .in('id', [...roleById.keys()])
      .eq('status', 'active')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ProjectRow[]).map((row) => ({ ...rowToProject(row), role: roleById.get(row.id) }));
  }

  async getProject(projectId: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from(PROJECTS_TABLE)
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToProject(data as ProjectRow) : null;
  }

  async createProject(userId: string, input: CreateProjectInput): Promise<Project> {
    const { data, error } = await supabase
      .from(PROJECTS_TABLE)
      .insert(insertFor(userId, input))
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowToProject(data as ProjectRow);
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const { data, error } = await supabase
      .from(PROJECTS_TABLE)
      .update(updateFor(patch))
      .eq('id', projectId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return rowToProject(data as ProjectRow);
  }

  async archiveProject(projectId: string): Promise<void> {
    await this.updateProject(projectId, { status: 'archived' });
  }

  async getActiveProjectId(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from(PREFERENCES_TABLE)
      .select('active_project_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PreferenceRow | null)?.active_project_id ?? null;
  }

  async setActiveProjectId(userId: string, projectId: string): Promise<void> {
    const { error } = await supabase
      .from(PREFERENCES_TABLE)
      .upsert({ user_id: userId, active_project_id: projectId }, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);

    await supabase
      .from(PROJECTS_TABLE)
      .update({ last_opened_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('owner_user_id', userId);
  }
}

export class InMemoryProjectBackend implements ProjectBackend {
  private projects = new Map<string, Project>();
  private activeByUser = new Map<string, string>();
  /** project_id -> (user_id -> role). Mirrors larund_project_members. */
  private members = new Map<string, Map<string, ProjectRole>>();

  /** Test helper: add/replace a membership row. */
  addMember(projectId: string, userId: string, role: ProjectRole): void {
    let m = this.members.get(projectId);
    if (!m) { m = new Map(); this.members.set(projectId, m); }
    m.set(userId, role);
  }

  /** Test helper: remove a membership row. */
  removeMember(projectId: string, userId: string): void {
    this.members.get(projectId)?.delete(userId);
  }

  async listProjects(userId: string): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((p) => p.status === 'active' && this.members.get(p.id)?.has(userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ ...structuredClone(p), role: this.members.get(p.id)!.get(userId) }));
  }

  async getProject(projectId: string): Promise<Project | null> {
    const p = this.projects.get(projectId);
    return p ? structuredClone(p) : null;
  }

  async createProject(userId: string, input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: uuidv4(),
      ownerUserId: userId,
      createdByUserId: userId,
      name: input.name.trim() || 'Untitled Project',
      description: input.description?.trim() ?? '',
      kind: input.kind ?? 'project',
      status: 'active',
      color: input.color ?? null,
      icon: input.icon ?? 'folder',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      lastOpenedAt: null,
    };
    this.projects.set(project.id, project);
    this.addMember(project.id, userId, 'owner');
    return structuredClone(project);
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const existing = this.projects.get(projectId);
    if (!existing) throw new Error('project not found');
    const next: Project = {
      ...existing,
      ...patch,
      id: existing.id,
      ownerUserId: existing.ownerUserId,
      createdByUserId: existing.createdByUserId,
      description: patch.description ?? existing.description,
      color: patch.color !== undefined ? patch.color : existing.color,
      icon: patch.icon !== undefined ? patch.icon : existing.icon,
      updatedAt: new Date().toISOString(),
      archivedAt: patch.status === 'archived' ? new Date().toISOString() : existing.archivedAt,
    };
    this.projects.set(projectId, next);
    return structuredClone(next);
  }

  async archiveProject(projectId: string): Promise<void> {
    await this.updateProject(projectId, { status: 'archived' });
  }

  async getActiveProjectId(userId: string): Promise<string | null> {
    return this.activeByUser.get(userId) ?? null;
  }

  async setActiveProjectId(userId: string, projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project || project.status !== 'active' || !this.members.get(projectId)?.has(userId)) {
      throw new Error('project is not available to this user');
    }
    project.lastOpenedAt = new Date().toISOString();
    project.updatedAt = project.updatedAt || project.lastOpenedAt;
    this.activeByUser.set(userId, projectId);
  }
}

let backend: ProjectBackend = new SupabaseProjectBackend();

export function setProjectBackendForTests(next: ProjectBackend): void {
  backend = next;
}

export function resetProjectBackend(): void {
  backend = new SupabaseProjectBackend();
}

export async function listProjects(userId: string): Promise<Project[]> {
  return backend.listProjects(userId);
}

export async function getProject(projectId: string): Promise<Project | null> {
  return backend.getProject(projectId);
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<Project> {
  const project = await backend.createProject(userId, input);
  await backend.setActiveProjectId(userId, project.id);
  return project;
}

export async function updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
  return backend.updateProject(projectId, patch);
}

export async function archiveProject(projectId: string): Promise<void> {
  await backend.archiveProject(projectId);
}

export async function getActiveProjectId(userId: string): Promise<string | null> {
  return backend.getActiveProjectId(userId);
}

export async function setActiveProjectId(userId: string, projectId: string): Promise<void> {
  // Accessible = owned or joined as a member. Members can make a shared project active.
  const projects = await backend.listProjects(userId);
  if (!projects.some((p) => p.id === projectId && p.status === 'active')) {
    throw new Error('project is not available to this user');
  }
  await backend.setActiveProjectId(userId, projectId);
}

export async function ensureDefaultProject(userId: string): Promise<Project> {
  const projects = await backend.listProjects(userId);
  if (projects.length > 0) return projects[0];

  const project = await backend.createProject(userId, {
    name: 'Personal',
    description: 'Your default project.',
    kind: 'personal',
    icon: 'folder',
  });
  await backend.setActiveProjectId(userId, project.id);
  return project;
}

export async function resolveActiveProject(userId: string): Promise<Project> {
  // Source of truth is the accessible project list (owned + joined). This makes
  // the active selection survive ownership transfers: if the active project is
  // no longer accessible (it was transferred away), we fall back automatically.
  const projects = await backend.listProjects(userId);
  if (projects.length === 0) {
    return ensureDefaultProject(userId);
  }

  const activeId = await backend.getActiveProjectId(userId);
  const active = activeId ? projects.find((p) => p.id === activeId) : undefined;
  if (active) return active;

  const fallback = projects[0];
  await backend.setActiveProjectId(userId, fallback.id);
  return fallback;
}
