import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createNotification, listNotifications, markRead } from '../store';

beforeEach(() => resetRecordBackendForTests());

describe('notifications', () => {
  it('creates, lists, and marks notifications read', async () => {
    const note = await createNotification({ userId: 'u1', kind: 'system', title: 'Hello', body: 'World' });
    expect(await listNotifications({ userId: 'u1', unreadOnly: true })).toHaveLength(1);
    await markRead(note.id);
    expect(await listNotifications({ userId: 'u1', unreadOnly: true })).toHaveLength(0);
  });
});
