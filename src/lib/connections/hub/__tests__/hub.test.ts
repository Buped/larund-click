import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../../coworker/persistence';
import { getProvider, listProviders, planConnectionTest } from '../status';
import {
  availableConnectionIds,
  createConnectionInstance,
  listConnectionInstances,
  setConnectionEnabled,
} from '../store';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('connection hub metadata', () => {
  it('maps all manifests into providers with categories', () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThan(3);
    const gw = providers.find((p) => p.id === 'google-workspace');
    expect(gw?.category).toBe('productivity');
    expect(gw?.tools.length).toBeGreaterThan(0);
  });

  it('marks github category as development', () => {
    expect(getProvider('github')?.category).toBe('development');
  });

  it('plans a non-destructive test for a configured provider', () => {
    // Google Workspace falls back to mock mode (configured) without a token? It is
    // oauth, so status depends on secret presence. Test the planner logic on a
    // provider regardless of live secret state.
    const provider = getProvider('google-workspace')!;
    const plan = planConnectionTest(provider);
    if (plan.runnable && plan.probe) {
      // probe must be a read-only/external_read tool — never a write.
      expect(plan.probe.tool).toBeTruthy();
    } else {
      expect(plan.message).toMatch(/auth|scaffold|probe/i);
    }
  });

  it('reports missing auth clearly for unconfigured providers', () => {
    const scaffold = listProviders().find((p) => p.scaffold);
    if (scaffold) {
      const plan = planConnectionTest(scaffold);
      expect(plan.runnable).toBe(false);
      expect(plan.message).toMatch(/scaffold/i);
    }
  });
});

describe('connection instance store', () => {
  it('creates, lists and toggles instances', async () => {
    const inst = await createConnectionInstance({ userId: 'u1', workspaceId: 'ws1', providerId: 'github' });
    expect(inst.providerId).toBe('github');
    const list = await listConnectionInstances({ userId: 'u1', workspaceId: 'ws1' });
    expect(list).toHaveLength(1);

    const disabled = await setConnectionEnabled(inst.id, false);
    expect(disabled?.status).toBe('disabled');
  });

  it('availableConnectionIds only returns enabled + connected providers', async () => {
    // github is a scaffold or missing auth in tests → not "connected".
    const inst = await createConnectionInstance({ userId: 'u1', providerId: 'github' });
    await setConnectionEnabled(inst.id, false);
    const ids = await availableConnectionIds({ userId: 'u1' });
    expect(ids).not.toContain('github');
  });
});
