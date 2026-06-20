// Workspace store. Internal data-scoping plumbing for coworker records,
// automations, skills and the gateway — each scopes data by the active workspace
// id, which App.tsx keeps pointed at the active project id. This is local-only;
// user-facing collaboration (members, invites, ownership) lives in
// src/lib/projects, backed by Supabase. Falls back to an auto-created default
// workspace so the agent always has a context.

import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { CreateWorkspaceInput, Workspace, WorkspacePatch } from './types';
import { defaultWorkspaceId, makeDefaultWorkspace, normalizeCreateInput } from './defaults';

const COLLECTION = 'workspaces';

// Active-workspace selection is session-scoped and ephemeral, so it lives in
// memory (it is re-resolved to the default on restart).
const activeBySession = new Map<string, string>();

function toWorkspace(row: RecordRow): Workspace {
  return row as unknown as Workspace;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const ws = normalizeCreateInput(input, new Date().toISOString());
  await recordBackend().put(COLLECTION, ws as unknown as RecordRow);
  return ws;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const row = await recordBackend().get(COLLECTION, id);
  return row ? toWorkspace(row) : null;
}

export async function updateWorkspace(id: string, patch: WorkspacePatch): Promise<Workspace | null> {
  const existing = await getWorkspace(id);
  if (!existing) return null;
  const updated: Workspace = {
    ...existing,
    ...patch,
    id: existing.id,
    userId: existing.userId,
    memoryScope: 'workspace',
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await recordBackend().put(COLLECTION, updated as unknown as RecordRow);
  return updated;
}

/** Soft-delete: mark archived but keep history. */
export async function archiveWorkspace(id: string): Promise<Workspace | null> {
  return updateWorkspace(id, { archivedAt: new Date().toISOString() });
}

/** Hard delete. Use archiveWorkspace for the normal UI flow. */
export async function deleteWorkspace(id: string): Promise<void> {
  await recordBackend().delete(COLLECTION, id);
  for (const [sessionId, wsId] of activeBySession) {
    if (wsId === id) activeBySession.delete(sessionId);
  }
}

export async function listWorkspaces(userId: string, includeArchived = false): Promise<Workspace[]> {
  const rows = await recordBackend().all(COLLECTION);
  return rows
    .map(toWorkspace)
    .filter((w) => w.userId === userId && (includeArchived || !w.archivedAt))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Return the user's default workspace, creating and persisting it on first call.
 * This guarantees the agent always has a workspace to run in.
 */
export async function getDefaultWorkspace(userId: string): Promise<Workspace> {
  const id = defaultWorkspaceId(userId);
  const existing = await getWorkspace(id);
  if (existing) return existing;
  const ws = makeDefaultWorkspace(userId);
  await recordBackend().put(COLLECTION, ws as unknown as RecordRow);
  return ws;
}

export function setActiveWorkspace(sessionId: string, workspaceId: string): void {
  activeBySession.set(sessionId, workspaceId);
}

export function getActiveWorkspaceId(sessionId: string): string | undefined {
  return activeBySession.get(sessionId);
}

/**
 * Resolve the workspace for a run: an explicitly-set active workspace if it
 * still exists and is not archived, otherwise the user's default workspace.
 */
export async function resolveActiveWorkspace(sessionId: string, userId: string): Promise<Workspace> {
  const activeId = activeBySession.get(sessionId);
  if (activeId) {
    const ws = await getWorkspace(activeId);
    if (ws && ws.userId === userId && !ws.archivedAt) return ws;
  }
  return getDefaultWorkspace(userId);
}
