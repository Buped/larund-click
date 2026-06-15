import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { CreateNotificationInput, Notification } from './types';

const TABLE = 'notifications';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNotification(row: RecordRow): Notification {
  return row as unknown as Notification;
}

export async function createNotification(input: CreateNotificationInput): Promise<Notification> {
  const notification: Notification = {
    id: id('note'),
    read: false,
    createdAt: new Date().toISOString(),
    ...input,
  };
  await recordBackend().put(TABLE, notification as unknown as RecordRow);
  return notification;
}

export async function listNotifications(filter: {
  userId: string;
  workspaceId?: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  const rows = await recordBackend().all(TABLE);
  const items = rows
    .map(toNotification)
    .filter((n) => n.userId === filter.userId)
    .filter((n) => !filter.workspaceId || n.workspaceId === filter.workspaceId)
    .filter((n) => !filter.unreadOnly || !n.read)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return typeof filter.limit === 'number' ? items.slice(0, filter.limit) : items;
}

export async function markRead(id: string, read = true): Promise<Notification | null> {
  const row = await recordBackend().get(TABLE, id);
  if (!row) return null;
  const notification = { ...toNotification(row), read };
  await recordBackend().put(TABLE, notification as unknown as RecordRow);
  return notification;
}

export async function markAllRead(userId: string): Promise<void> {
  const notes = await listNotifications({ userId });
  await Promise.all(notes.map((n) => markRead(n.id, true)));
}
