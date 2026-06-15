// Connection instance store — a user's configured connections per workspace.
// Backed by the shared coworker persistence. Provider definitions (what's
// available) come from status.ts; instances (what's configured) live here.

import { recordBackend, type RecordRow } from '../../coworker/persistence';
import type { ConnectionInstance, CreateConnectionInstanceInput, InstanceStatus } from './types';
import { getProvider } from './status';

const COLLECTION = 'connection_instances';

function toInstance(row: RecordRow): ConnectionInstance {
  return row as unknown as ConnectionInstance;
}

function deriveStatus(providerId: string, enabled: boolean): InstanceStatus {
  if (!enabled) return 'disabled';
  const provider = getProvider(providerId);
  if (!provider) return 'error';
  if (provider.status === 'missing_auth' || provider.scaffold) return 'missing_auth';
  return 'connected';
}

export async function createConnectionInstance(
  input: CreateConnectionInstanceInput,
): Promise<ConnectionInstance> {
  const now = new Date().toISOString();
  const provider = getProvider(input.providerId);
  const enabled = input.enabled ?? true;
  const instance: ConnectionInstance = {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    providerId: input.providerId,
    displayName: input.displayName ?? provider?.name ?? input.providerId,
    enabled,
    scopes: input.scopes ?? provider?.scopes ?? [],
    secretsRef: input.secretsRef,
    createdAt: now,
    updatedAt: now,
    status: deriveStatus(input.providerId, enabled),
  };
  await recordBackend().put(COLLECTION, instance as unknown as RecordRow);
  return instance;
}

export async function getConnectionInstance(id: string): Promise<ConnectionInstance | null> {
  const row = await recordBackend().get(COLLECTION, id);
  return row ? toInstance(row) : null;
}

export async function setConnectionEnabled(id: string, enabled: boolean): Promise<ConnectionInstance | null> {
  const existing = await getConnectionInstance(id);
  if (!existing) return null;
  const updated: ConnectionInstance = {
    ...existing,
    enabled,
    status: deriveStatus(existing.providerId, enabled),
    updatedAt: new Date().toISOString(),
  };
  await recordBackend().put(COLLECTION, updated as unknown as RecordRow);
  return updated;
}

export async function markConnectionUsed(id: string): Promise<void> {
  const existing = await getConnectionInstance(id);
  if (!existing) return;
  await recordBackend().put(COLLECTION, {
    ...(existing as unknown as RecordRow),
    lastUsedAt: new Date().toISOString(),
  });
}

export async function deleteConnectionInstance(id: string): Promise<void> {
  await recordBackend().delete(COLLECTION, id);
}

export async function listConnectionInstances(filter: {
  userId: string;
  workspaceId?: string;
}): Promise<ConnectionInstance[]> {
  const rows = await recordBackend().all(COLLECTION);
  return rows
    .map(toInstance)
    .filter((c) => c.userId === filter.userId)
    .filter((c) => !filter.workspaceId || !c.workspaceId || c.workspaceId === filter.workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Provider ids that are enabled + connected for a workspace (for skill ranking). */
export async function availableConnectionIds(filter: {
  userId: string;
  workspaceId?: string;
}): Promise<string[]> {
  const instances = await listConnectionInstances(filter);
  return [
    ...new Set(
      instances.filter((c) => c.enabled && c.status === 'connected').map((c) => c.providerId),
    ),
  ];
}
