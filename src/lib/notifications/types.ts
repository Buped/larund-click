export type NotificationKind =
  | 'task_completed'
  | 'task_failed'
  | 'approval_needed'
  | 'automation_failed'
  | 'connection_error'
  | 'memory_suggestion'
  | 'system';

export interface Notification {
  id: string;
  userId: string;
  workspaceId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  actionUrl?: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateNotificationInput {
  userId: string;
  workspaceId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}
