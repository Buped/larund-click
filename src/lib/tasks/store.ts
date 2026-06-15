// Task + Evidence store. Persists TaskRuns and EvidenceEntries through the shared
// coworker backend. The agent loop creates a TaskRun at start, appends evidence
// as steps stream in, and finalizes status on completion/failure/block.

import { recordBackend, type RecordRow } from '../coworker/persistence';
import { redactSecrets } from '../tools/audit';
import type {
  AddEvidenceInput,
  CreateTaskRunInput,
  EvidenceEntry,
  OutputRef,
  TaskRun,
  TaskStatus,
} from './types';

const TASKS = 'task_runs';
const EVIDENCE = 'task_evidence';

function toTask(row: RecordRow): TaskRun {
  return row as unknown as TaskRun;
}
function toEvidence(row: RecordRow): EvidenceEntry {
  return row as unknown as EvidenceEntry;
}

export async function createTaskRun(input: CreateTaskRunInput): Promise<TaskRun> {
  const now = new Date().toISOString();
  const run: TaskRun = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    title: input.title.trim() || 'Untitled task',
    originalPrompt: input.originalPrompt,
    status: input.status ?? 'running',
    activeSkillIds: input.activeSkillIds ?? [],
    connectionIds: input.connectionIds ?? [],
    modelId: input.modelId,
    autonomyMode: input.autonomyMode,
    startedAt: now,
    updatedAt: now,
    outputRefs: [],
    evidenceIds: [],
    metadata: input.metadata,
  };
  await recordBackend().put(TASKS, run as unknown as RecordRow);
  return run;
}

export async function getTaskRun(id: string): Promise<TaskRun | null> {
  const row = await recordBackend().get(TASKS, id);
  return row ? toTask(row) : null;
}

async function saveTask(run: TaskRun): Promise<TaskRun> {
  run.updatedAt = new Date().toISOString();
  await recordBackend().put(TASKS, run as unknown as RecordRow);
  return run;
}

export async function setTaskStatus(
  id: string,
  status: TaskStatus,
  extra: { error?: string; summary?: string } = {},
): Promise<TaskRun | null> {
  const run = await getTaskRun(id);
  if (!run) return null;
  run.status = status;
  if (extra.error !== undefined) run.error = extra.error;
  if (extra.summary !== undefined) run.summary = extra.summary;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    run.completedAt = new Date().toISOString();
  }
  return saveTask(run);
}

export async function addOutputRef(taskId: string, ref: Omit<OutputRef, 'id'>): Promise<TaskRun | null> {
  const run = await getTaskRun(taskId);
  if (!run) return null;
  // De-dupe by uri so repeated read-backs of the same artifact don't pile up.
  if (run.outputRefs.some((r) => r.uri === ref.uri)) return run;
  run.outputRefs.push({ id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...ref });
  return saveTask(run);
}

export async function addEvidence(input: AddEvidenceInput): Promise<EvidenceEntry> {
  const entry: EvidenceEntry = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...input,
    content: redactSecrets(input.content),
  };
  await recordBackend().put(EVIDENCE, entry as unknown as RecordRow);
  const run = await getTaskRun(input.taskRunId);
  if (run) {
    run.evidenceIds.push(entry.id);
    await saveTask(run);
  }
  return entry;
}

export async function listTaskRuns(filter: {
  userId: string;
  workspaceId?: string;
  status?: TaskStatus;
}): Promise<TaskRun[]> {
  const rows = await recordBackend().all(TASKS);
  return rows
    .map(toTask)
    .filter((t) => t.userId === filter.userId)
    .filter((t) => !filter.workspaceId || t.workspaceId === filter.workspaceId)
    .filter((t) => !filter.status || t.status === filter.status)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function listEvidence(taskRunId: string): Promise<EvidenceEntry[]> {
  const rows = await recordBackend().all(EVIDENCE);
  return rows
    .map(toEvidence)
    .filter((e) => e.taskRunId === taskRunId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteTaskRun(id: string): Promise<void> {
  const evidence = await listEvidence(id);
  await Promise.all(evidence.map((e) => recordBackend().delete(EVIDENCE, e.id)));
  await recordBackend().delete(TASKS, id);
}
