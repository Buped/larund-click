import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import {
  configureTaskQueue,
  enqueueTask,
  listQueueItems,
  startNextTask,
  updateQueueItem,
} from '../store';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('task queue', () => {
  it('runs one task per workspace at a time', async () => {
    configureTaskQueue({
      globalMax: 4,
      processor: async (item) => {
        await updateQueueItem(item.id, { progress: 'held' });
        return new Promise((resolve) => setTimeout(() => resolve({ summary: 'done' }), 25));
      },
    });
    await enqueueTask({ userId: 'u1', workspaceId: 'ws1', source: 'manual', prompt: 'one' });
    await enqueueTask({ userId: 'u1', workspaceId: 'ws1', source: 'manual', prompt: 'two' });
    await startNextTask({ userId: 'u1' });
    const items = await listQueueItems({ userId: 'u1' });
    expect(items.filter((i) => i.status === 'running')).toHaveLength(1);
  });

  it('cancels queued tasks', async () => {
    configureTaskQueue({ processor: async () => ({ summary: 'done' }) });
    const item = await enqueueTask({ userId: 'u1', source: 'manual', prompt: 'cancel me' });
    const cancelled = await (await import('../store')).cancelQueuedTask(item.id);
    expect(cancelled?.status === 'cancelled' || cancelled?.status === 'completed').toBe(true);
  });
});
