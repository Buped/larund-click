import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import {
  archiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  getDefaultWorkspace,
  getWorkspace,
  listWorkspaces,
  resolveActiveWorkspace,
  setActiveWorkspace,
  updateWorkspace,
} from '../store';
import { primaryLocalRoot, renderWorkspaceSummary } from '../registry';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('workspace store', () => {
  it('creates and reads a workspace', async () => {
    const ws = await createWorkspace({ userId: 'u1', name: 'Larund Dev', kind: 'project' });
    expect(ws.id).toBeTruthy();
    expect(ws.memoryScope).toBe('workspace');
    const fetched = await getWorkspace(ws.id);
    expect(fetched?.name).toBe('Larund Dev');
  });

  it('updates a workspace and bumps updatedAt', async () => {
    const ws = await createWorkspace({ userId: 'u1', name: 'A' });
    const updated = await updateWorkspace(ws.id, { name: 'B', autonomyMode: 'full' });
    expect(updated?.name).toBe('B');
    expect(updated?.autonomyMode).toBe('full');
    expect(updated?.userId).toBe('u1');
  });

  it('lists only a user own non-archived workspaces', async () => {
    await createWorkspace({ userId: 'u1', name: 'A' });
    const b = await createWorkspace({ userId: 'u1', name: 'B' });
    await createWorkspace({ userId: 'u2', name: 'C' });
    await archiveWorkspace(b.id);
    const list = await listWorkspaces('u1');
    expect(list.map((w) => w.name)).toEqual(['A']);
    const withArchived = await listWorkspaces('u1', true);
    expect(withArchived).toHaveLength(2);
  });

  it('auto-creates and reuses a default workspace', async () => {
    const d1 = await getDefaultWorkspace('u1');
    const d2 = await getDefaultWorkspace('u1');
    expect(d1.id).toBe(d2.id);
    expect(d1.kind).toBe('personal');
  });

  it('resolves active workspace, falling back to default', async () => {
    const fallback = await resolveActiveWorkspace('sess1', 'u1');
    expect(fallback.kind).toBe('personal');

    const dev = await createWorkspace({ userId: 'u1', name: 'Dev' });
    setActiveWorkspace('sess1', dev.id);
    const active = await resolveActiveWorkspace('sess1', 'u1');
    expect(active.id).toBe(dev.id);
  });

  it('falls back to default when active workspace was deleted', async () => {
    const dev = await createWorkspace({ userId: 'u1', name: 'Dev' });
    setActiveWorkspace('sess1', dev.id);
    await deleteWorkspace(dev.id);
    const active = await resolveActiveWorkspace('sess1', 'u1');
    expect(active.kind).toBe('personal');
  });
});

describe('workspace registry', () => {
  it('renders a compact summary with enabled roots and overrides', async () => {
    const ws = await createWorkspace({
      userId: 'u1',
      name: 'Client A',
      kind: 'client',
      rootPaths: [
        { id: 'r1', kind: 'local_folder', label: 'Repo', uri: 'D:/clientA', enabled: true },
        { id: 'r2', kind: 'url', label: 'Site', uri: 'https://x', enabled: false },
      ],
    });
    const summary = renderWorkspaceSummary(ws, {
      enabledConnectionNames: ['Google Workspace'],
      enabledSkillNames: ['file-organizer'],
    });
    expect(summary).toMatch(/Client A \(client\)/);
    expect(summary).toMatch(/Repo \[local_folder\]/);
    expect(summary).not.toMatch(/Site/); // disabled root excluded
    expect(summary).toMatch(/Google Workspace/);
    expect(summary).toMatch(/file-organizer/);
    expect(primaryLocalRoot(ws)).toBe('D:/clientA');
  });
});
