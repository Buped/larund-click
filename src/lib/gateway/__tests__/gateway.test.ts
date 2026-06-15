import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { listQueueItems } from '../../queue/store';
import { createWorkspace } from '../../workspaces/store';
import { parseGatewayCommand } from '../commands';
import { createGatewayChannel } from '../store';
import { routeGatewayMessage } from '../router';

beforeEach(() => resetRecordBackendForTests());

describe('gateway commands', () => {
  it('parses task and approval commands', () => {
    expect(parseGatewayCommand('/task do work')).toEqual({ kind: 'task', prompt: 'do work' });
    expect(parseGatewayCommand('/approve abc')).toEqual({ kind: 'approve', approvalId: 'abc' });
    expect(parseGatewayCommand('plain task')).toEqual({ kind: 'task', prompt: 'plain task' });
  });

  it('rejects unknown senders and queues trusted local gateway tasks', async () => {
    const ws = await createWorkspace({ userId: 'u1', name: 'Ops', kind: 'project' });
    const channel = await createGatewayChannel({
      userId: 'u1',
      workspaceId: ws.id,
      displayName: 'Local',
      trustedSenderIds: ['trusted'],
    });
    await expect(routeGatewayMessage({ channelId: channel.id, sender: 'stranger', text: '/task nope' })).resolves.toMatch(/not linked/);
    const reply = await routeGatewayMessage({ channelId: channel.id, sender: 'trusted', text: '/task create a test file' });
    expect(reply).toMatch(/Task queued/);
    const queue = await listQueueItems({ userId: 'u1' });
    expect(queue[0].source).toBe('gateway');
  });
});
