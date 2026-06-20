import { recordBackend, type RecordRow } from '../coworker/persistence';
import { addEvidence, createTaskRun, setTaskStatus } from '../tasks/store';
import { createNotification } from '../notifications/store';
import type {
  EnqueueTaskInput,
  TaskQueueItem,
  TaskQueuePriority,
  TaskQueueProcessor,
  TaskQueueProcessorResult,
  TaskQueueStatus,
} from './types';

const TABLE = 'task_queue';
const DEFAULT_GLOBAL_MAX = 4;

let processor: TaskQueueProcessor = defaultProcessor;
let globalMax = DEFAULT_GLOBAL_MAX;
let customProcessorConfigured = false;

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toItem(row: RecordRow): TaskQueueItem {
  return row as unknown as TaskQueueItem;
}

function priorityWeight(priority: TaskQueuePriority): number {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}

async function save(item: TaskQueueItem): Promise<TaskQueueItem> {
  await recordBackend().put(TABLE, item as unknown as RecordRow);
  return item;
}

export function configureTaskQueue(options: {
  processor?: TaskQueueProcessor;
  globalMax?: number;
}): void {
  if (options.processor) {
    processor = options.processor;
    customProcessorConfigured = true;
  }
  if (typeof options.globalMax === 'number' && options.globalMax > 0) globalMax = options.globalMax;
}

export function isTaskQueueProcessorConfigured(): boolean {
  return customProcessorConfigured;
}

export async function enqueueTask(input: EnqueueTaskInput): Promise<TaskQueueItem> {
  const item: TaskQueueItem = {
    id: id('queue'),
    userId: input.userId,
    workspaceId: input.workspaceId,
    source: input.source,
    prompt: input.prompt,
    priority: input.priority ?? 'normal',
    status: 'queued',
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
  };
  await save(item);
  void startNextTask({ userId: input.userId }).catch(() => undefined);
  return item;
}

export async function getQueueItem(id: string): Promise<TaskQueueItem | null> {
  const row = await recordBackend().get(TABLE, id);
  return row ? toItem(row) : null;
}

export async function listQueueItems(filter: {
  userId: string;
  workspaceId?: string;
  status?: TaskQueueStatus;
}): Promise<TaskQueueItem[]> {
  const rows = await recordBackend().all(TABLE);
  return rows
    .map(toItem)
    .filter((i) => i.userId === filter.userId)
    .filter((i) => !filter.workspaceId || i.workspaceId === filter.workspaceId)
    .filter((i) => !filter.status || i.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateQueueItem(
  id: string,
  patch: Partial<Pick<TaskQueueItem, 'status' | 'taskRunId' | 'completedAt' | 'startedAt' | 'error' | 'progress' | 'metadata'>>,
): Promise<TaskQueueItem | null> {
  const item = await getQueueItem(id);
  if (!item) return null;
  return save({ ...item, ...patch });
}

export async function cancelQueuedTask(id: string): Promise<TaskQueueItem | null> {
  const item = await getQueueItem(id);
  if (!item) return null;
  if (item.status !== 'queued' && item.status !== 'waiting_approval') return item;
  return save({ ...item, status: 'cancelled', completedAt: new Date().toISOString() });
}

export async function retryQueueItem(id: string): Promise<TaskQueueItem | null> {
  const item = await getQueueItem(id);
  if (!item || item.status !== 'failed') return item;
  const retried = await save({
    ...item,
    id: id.startsWith('queue-') ? id : item.id,
    status: 'queued',
    error: undefined,
    startedAt: undefined,
    completedAt: undefined,
    taskRunId: undefined,
    progress: 'Retry queued',
  });
  void startNextTask({ userId: item.userId }).catch(() => undefined);
  return retried;
}

export async function startNextTask(options: { userId: string }): Promise<TaskQueueItem | null> {
  const all = await listQueueItems({ userId: options.userId });
  const running = all.filter((i) => i.status === 'running');
  if (running.length >= globalMax) return null;

  const queued = all
    .filter((i) => i.status === 'queued')
    .filter((candidate) => {
      const key = candidate.workspaceId ?? `user:${candidate.userId}`;
      return !running.some((r) => (r.workspaceId ?? `user:${r.userId}`) === key);
    })
    .sort((a, b) => {
      const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
      return byPriority || a.createdAt.localeCompare(b.createdAt);
    });

  const next = queued[0];
  if (!next) return null;
  const started = await save({
    ...next,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: 'Running',
  });

  void runItem(started).finally(() => startNextTask({ userId: options.userId }).catch(() => undefined));
  return started;
}

async function runItem(item: TaskQueueItem): Promise<void> {
  try {
    const result = await processor(item);
    const finishedAt = new Date().toISOString();
    if (result.cancelled) {
      await save({
        ...item,
        status: 'cancelled',
        taskRunId: result.taskRunId,
        completedAt: finishedAt,
        progress: result.summary ?? 'Cancelled',
      });
      await updateLinkedAutomationRun(item, 'cancelled', { taskRunId: result.taskRunId });
      return;
    }
    if (result.waitingApproval) {
      await save({ ...item, status: 'waiting_approval', taskRunId: result.taskRunId, progress: 'Waiting for approval' });
      return;
    }
    await save({
      ...item,
      taskRunId: result.taskRunId,
      status: 'completed',
      completedAt: finishedAt,
      progress: result.summary ?? 'Completed',
    });
    await updateLinkedAutomationRun(item, 'completed', { taskRunId: result.taskRunId });
    await createNotification({
      userId: item.userId,
      workspaceId: item.workspaceId,
      kind: 'task_completed',
      title: 'Task completed',
      body: result.summary ?? item.prompt.slice(0, 140),
      actionUrl: result.taskRunId ? `task:${result.taskRunId}` : undefined,
      metadata: { queueItemId: item.id, taskRunId: result.taskRunId, source: item.source },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await save({
      ...item,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
      progress: 'Failed',
    });
    await updateLinkedAutomationRun(item, 'failed', { error: message });
    await createNotification({
      userId: item.userId,
      workspaceId: item.workspaceId,
      kind: 'task_failed',
      title: 'Task failed',
      body: message,
      metadata: { queueItemId: item.id, source: item.source },
    });
  }
}

async function defaultProcessor(item: TaskQueueItem): Promise<TaskQueueProcessorResult> {
  if (item.source === 'automation') {
    throw new Error('Automation runner is not connected. Restart the app or register the agent queue processor before running automations.');
  }
  const run = await createTaskRun({
    userId: item.userId,
    workspaceId: item.workspaceId,
    sessionId: `queue:${item.id}`,
    title: item.prompt.split('\n')[0].slice(0, 80) || 'Queued task',
    originalPrompt: item.prompt,
    modelId: 'core',
    autonomyMode: (item.metadata?.autonomyMode as 'manual' | 'semi' | 'full' | undefined) ?? 'semi',
    activeSkillIds: (item.metadata?.skillIds as string[] | undefined) ?? [],
    connectionIds: (item.metadata?.requiredConnectionIds as string[] | undefined) ?? [],
    metadata: {
      source: item.source,
      queueItemId: item.id,
      ...item.metadata,
    },
  });
  await addEvidence({
    taskRunId: run.id,
    userId: item.userId,
    workspaceId: item.workspaceId,
    kind: 'tool_call',
    title: 'Queued task accepted',
    content: `Source: ${item.source}\nPrompt: ${item.prompt}`,
    tool: 'task.queue',
    success: true,
    metadata: { queueItemId: item.id },
  });
  await addEvidence({
    taskRunId: run.id,
    userId: item.userId,
    workspaceId: item.workspaceId,
    kind: 'verification',
    title: 'Queue run recorded',
    content: 'The background queue created a durable TaskRun and evidence entry. Full agent execution can attach through a custom queue processor.',
    tool: 'task.queue',
    success: true,
  });
  await setTaskStatus(run.id, 'completed', { summary: 'Queued background task recorded with evidence.' });
  return { taskRunId: run.id, summary: 'Queued background task recorded with evidence.' };
}

async function updateLinkedAutomationRun(
  item: TaskQueueItem,
  status: 'completed' | 'failed' | 'cancelled',
  extra: { taskRunId?: string; error?: string },
): Promise<void> {
  const automationRunId = item.metadata?.automationRunId;
  const automationId = item.metadata?.automationId;
  if (typeof automationRunId !== 'string') return;
  try {
    const automations = await import('../automations/store');
    await automations.updateAutomationRun(automationRunId, { status, taskRunId: extra.taskRunId, error: extra.error });
    if (typeof automationId === 'string') {
      await automations.recordAutomationRunResult(automationId, status, {
        taskRunId: extra.taskRunId,
        queueItemId: item.id,
        error: extra.error,
      });
    }
  } catch {
    /* best-effort; queue completion remains the source of truth */
  }
}
