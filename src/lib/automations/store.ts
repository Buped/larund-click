import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { Automation, AutomationRun, AutomationRunStatus, CreateAutomationInput } from './types';
import { calculateNextRun } from './schedule';

const AUTOMATIONS = 'automations';
const RUNS = 'automation_runs';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toAutomation(row: RecordRow): Automation {
  return row as unknown as Automation;
}

function toRun(row: RecordRow): AutomationRun {
  return row as unknown as AutomationRun;
}

async function saveAutomation(auto: Automation): Promise<Automation> {
  auto.updatedAt = new Date().toISOString();
  await recordBackend().put(AUTOMATIONS, auto as unknown as RecordRow);
  return auto;
}

async function syncAutomationTimer(auto: Automation): Promise<void> {
  const scheduler = await import('./scheduler');
  if (auto.enabled && auto.status === 'active') await scheduler.restoreAutomation(auto);
  else scheduler.stopAutomationTimer(auto.id);
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  const now = new Date().toISOString();
  const automation: Automation = {
    id: id('auto'),
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name.trim() || 'Untitled automation',
    description: input.description,
    enabled: input.enabled ?? true,
    trigger: input.trigger,
    taskTemplate: input.taskTemplate,
    autonomyMode: input.autonomyMode ?? 'semi',
    approvalPolicy: input.approvalPolicy ?? {
      externalSendRequiresApproval: true,
      destructiveRequiresApproval: true,
    },
    status: input.enabled === false ? 'disabled' : 'active',
    prompt: input.prompt ?? input.taskTemplate.prompt,
    referencedContext: input.referencedContext ?? [],
    steps: input.steps ?? [],
    verificationChecklist: input.verificationChecklist,
    safetyPolicy: input.safetyPolicy,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
  automation.nextRunAt = calculateNextRun(automation.trigger, new Date(now))?.toISOString();
  await recordBackend().put(AUTOMATIONS, automation as unknown as RecordRow);
  await syncAutomationTimer(automation);
  return automation;
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const row = await recordBackend().get(AUTOMATIONS, id);
  return row ? toAutomation(row) : null;
}

export async function listAutomations(filter: {
  userId: string;
  workspaceId?: string;
  includeDisabled?: boolean;
}): Promise<Automation[]> {
  const rows = await recordBackend().all(AUTOMATIONS);
  return rows
    .map(toAutomation)
    .filter((a) => a.userId === filter.userId)
    .filter((a) => !filter.workspaceId || a.workspaceId === filter.workspaceId)
    .filter((a) => filter.includeDisabled || a.status !== 'disabled')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateAutomation(id: string, patch: Partial<Omit<Automation, 'id' | 'createdAt'>>): Promise<Automation | null> {
  const automation = await getAutomation(id);
  if (!automation) return null;
  const updated = { ...automation, ...patch };
  if (patch.trigger) updated.nextRunAt = calculateNextRun(updated.trigger, new Date())?.toISOString();
  const saved = await saveAutomation(updated);
  await syncAutomationTimer(saved);
  return saved;
}

export async function pauseAutomation(id: string): Promise<Automation | null> {
  const automation = await getAutomation(id);
  if (!automation) return null;
  const saved = await saveAutomation({ ...automation, enabled: false, status: 'paused' });
  await syncAutomationTimer(saved);
  return saved;
}

export async function resumeAutomation(id: string): Promise<Automation | null> {
  const automation = await getAutomation(id);
  if (!automation) return null;
  const saved = await saveAutomation({
    ...automation,
    enabled: true,
    status: 'active',
    nextRunAt: calculateNextRun(automation.trigger, new Date())?.toISOString(),
  });
  await syncAutomationTimer(saved);
  return saved;
}

export async function deleteAutomation(id: string): Promise<void> {
  const scheduler = await import('./scheduler');
  scheduler.stopAutomationTimer(id);
  const runs = await listAutomationRuns(id);
  await Promise.all(runs.map((r) => recordBackend().delete(RUNS, r.id)));
  await recordBackend().delete(AUTOMATIONS, id);
}

export async function createAutomationRun(input: {
  automationId: string;
  status?: AutomationRunStatus;
  triggerPayload?: Record<string, unknown>;
}): Promise<AutomationRun> {
  const automation = await getAutomation(input.automationId);
  const run: AutomationRun = {
    id: id('auto-run'),
    automationId: input.automationId,
    workspaceId: automation?.workspaceId,
    status: input.status ?? 'queued',
    startedAt: input.status === 'skipped' ? undefined : new Date().toISOString(),
    completedAt: input.status === 'skipped' ? new Date().toISOString() : undefined,
    triggerPayload: input.triggerPayload,
  };
  await recordBackend().put(RUNS, run as unknown as RecordRow);
  return run;
}

export async function updateAutomationRun(
  id: string,
  patch: Partial<Omit<AutomationRun, 'id' | 'automationId'>>,
): Promise<AutomationRun | null> {
  const row = await recordBackend().get(RUNS, id);
  if (!row) return null;
  const run = { ...toRun(row), ...patch };
  if (['completed', 'failed', 'cancelled', 'skipped'].includes(run.status)) run.completedAt = run.completedAt ?? new Date().toISOString();
  await recordBackend().put(RUNS, run as unknown as RecordRow);
  return run;
}

export async function getAutomationRun(id: string): Promise<AutomationRun | null> {
  const row = await recordBackend().get(RUNS, id);
  return row ? toRun(row) : null;
}

export async function listAutomationRuns(automationId: string): Promise<AutomationRun[]> {
  const rows = await recordBackend().all(RUNS);
  return rows
    .map(toRun)
    .filter((r) => r.automationId === automationId)
    .sort((a, b) => (b.startedAt ?? b.completedAt ?? '').localeCompare(a.startedAt ?? a.completedAt ?? ''));
}

export async function recordAutomationRunResult(
  automationId: string,
  status: AutomationRunStatus,
  extra: { error?: string; taskRunId?: string; queueItemId?: string } = {},
): Promise<Automation | null> {
  const automation = await getAutomation(automationId);
  if (!automation) return null;
  return saveAutomation({
    ...automation,
    status: status === 'failed' ? 'error' : automation.status === 'disabled' ? 'disabled' : 'active',
    lastRunAt: new Date().toISOString(),
    nextRunAt: calculateNextRun(automation.trigger, new Date())?.toISOString(),
    metadata: {
      ...automation.metadata,
      lastError: extra.error,
      lastTaskRunId: extra.taskRunId,
      lastQueueItemId: extra.queueItemId,
    },
  });
}
