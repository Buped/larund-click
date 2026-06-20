import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveProject,
  createProject,
  ensureDefaultProject,
  getActiveProjectId,
  InMemoryProjectBackend,
  listProjects,
  resetProjectBackend,
  resolveActiveProject,
  setActiveProjectId,
  setProjectBackendForTests,
} from '../store';

describe('projects store', () => {
  beforeEach(() => {
    setProjectBackendForTests(new InMemoryProjectBackend());
  });

  afterEach(() => {
    resetProjectBackend();
  });

  it('creates a default project for a new user and makes it active', async () => {
    const project = await ensureDefaultProject('user-1');

    expect(project.name).toBe('Personal');
    expect(project.ownerUserId).toBe('user-1');
    await expect(getActiveProjectId('user-1')).resolves.toBe(project.id);
  });

  it('lists only active projects owned by the current user', async () => {
    const mine = await createProject('user-1', { name: 'Client Alpha' });
    await createProject('user-2', { name: 'Other User Project' });

    const projects = await listProjects('user-1');

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(mine.id);
  });

  it('sets and restores the active project preference', async () => {
    const first = await createProject('user-1', { name: 'First' });
    const second = await createProject('user-1', { name: 'Second' });

    await setActiveProjectId('user-1', first.id);
    await expect(getActiveProjectId('user-1')).resolves.toBe(first.id);

    const restored = await resolveActiveProject('user-1');

    expect(restored.id).toBe(first.id);
    expect(second.ownerUserId).toBe('user-1');
  });

  it('keeps existing projects when creating a new one', async () => {
    const first = await createProject('user-1', { name: 'First' });
    const second = await createProject('user-1', { name: 'Second' });

    const projects = await listProjects('user-1');

    expect(projects.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('rejects switching to another user project', async () => {
    const foreign = await createProject('user-2', { name: 'Foreign' });

    await expect(setActiveProjectId('user-1', foreign.id)).rejects.toThrow('project is not available');
  });

  it('filters archived projects and falls back to an active one', async () => {
    const archived = await createProject('user-1', { name: 'Old' });
    const active = await createProject('user-1', { name: 'Current' });
    await archiveProject(archived.id);

    const projects = await listProjects('user-1');
    const restored = await resolveActiveProject('user-1');

    expect(projects.map((p) => p.id)).toEqual([active.id]);
    expect(restored.id).toBe(active.id);
  });
});

describe('project collaboration (membership + roles)', () => {
  let backend: InMemoryProjectBackend;
  beforeEach(() => { backend = new InMemoryProjectBackend(); setProjectBackendForTests(backend); });
  afterEach(() => { resetProjectBackend(); });

  it('attaches the owner role to the creator', async () => {
    await createProject('owner-1', { name: 'Client Ops' });
    const [p] = await listProjects('owner-1');
    expect(p.role).toBe('owner');
  });

  it('shows a project to a member and hides it from non-members', async () => {
    const project = await createProject('owner-1', { name: 'Client Ops' });
    backend.addMember(project.id, 'member-1', 'member');

    const ownerView = await listProjects('owner-1');
    const memberView = await listProjects('member-1');
    const strangerView = await listProjects('stranger-1');

    expect(ownerView).toHaveLength(1);
    expect(memberView).toHaveLength(1);
    expect(memberView[0].role).toBe('member');
    expect(strangerView).toHaveLength(0);
  });

  it('lets a member make a shared project active', async () => {
    const project = await createProject('owner-1', { name: 'Client Ops' });
    backend.addMember(project.id, 'member-1', 'member');

    await setActiveProjectId('member-1', project.id);
    await expect(getActiveProjectId('member-1')).resolves.toBe(project.id);
  });

  it('falls back when the active project is no longer accessible (ownership transferred away)', async () => {
    const transferred = await createProject('owner-1', { name: 'Transferred' });
    const other = await createProject('owner-1', { name: 'Keeper' });
    await setActiveProjectId('owner-1', transferred.id);

    // Simulate accepting an ownership transfer: old owner loses their member row.
    backend.removeMember(transferred.id, 'owner-1');

    const projects = await listProjects('owner-1');
    const restored = await resolveActiveProject('owner-1');

    expect(projects.map((p) => p.id)).toEqual([other.id]);
    expect(restored.id).toBe(other.id);
  });
});
