export type TaskQueueSource = 'chat' | 'automation' | 'gateway' | 'manual';
export type TaskQueuePriority = 'low' | 'normal' | 'high';
export type TaskQueueStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskQueueItem {
  id: string;
  userId: string;
  workspaceId?: string;
  source: TaskQueueSource;
  prompt: string;
  priority: TaskQueuePriority;
  status: TaskQueueStatus;
  taskRunId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  progress?: string;
  metadata?: Record<string, unknown>;
}

export interface EnqueueTaskInput {
  userId: string;
  workspaceId?: string;
  source: TaskQueueSource;
  prompt: string;
  priority?: TaskQueuePriority;
  metadata?: Record<string, unknown>;
}

export interface TaskQueueProcessorResult {
  taskRunId?: string;
  summary?: string;
  waitingApproval?: boolean;
  cancelled?: boolean;
}

export type TaskQueueProcessor = (item: TaskQueueItem) => Promise<TaskQueueProcessorResult>;
