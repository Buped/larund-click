import { runControlLoop, type AgentStatus, type AgentStep, type AgentAbortSignal } from '../control-system/loop';
import { configureTaskQueue, getQueueItem, updateQueueItem } from '../queue/store';
import type { TaskQueueItem, TaskQueueProcessorResult, TaskQueueStatus } from '../queue/types';
import { getTaskRun, listEvidence, listTaskRuns, setTaskStatus } from '../tasks/store';
import type { EvidenceEntry, TaskRun } from '../tasks/types';
import { createNotification } from '../notifications/store';
import { MODELS } from '../../constants/models';
import { normalizeAutomation } from './migrate';
import {
  getAutomation,
  getAutomationRun,
  recordAutomationRunResult,
  updateAutomationRun,
} from './store';
import type { AutomationRun, AutomationRunStatus, VerificationCheck } from './types';
import { riskPolicyForAutomationSafety, verifyAutomationEvidence } from './verification';
import { completeAutomationSetup, markAutomationSetupStatus } from './setup';
import {
  appendAutomationAgentStepMessage,
  appendAutomationApprovalMessage,
  appendAutomationAskUserMessage,
  appendAutomationCompletedMessage,
  appendAutomationFailedMessage,
  appendAutomationRunStartedMessage,
} from './chat-bridge';

type PendingAsk = {
  question: string;
  resolve: (answer: string) => void;
};

type PendingApproval = {
  action: string;
  risk: string;
  reason: string;
  argsSummary: string;
  resolve: (decision: 'allow_once' | 'allow_always' | 'deny') => void;
};

export interface AutomationRunLiveState {
  automationRunId?: string;
  queueItemId: string;
  taskRunId?: string;
  status: AutomationRunStatus | TaskQueueStatus;
  progress?: string;
  steps: AgentStep[];
  ask?: { question: string };
  approval?: Omit<PendingApproval, 'resolve'>;
}

export interface AutomationRunSnapshot {
  run: AutomationRun | null;
  queueItem: TaskQueueItem | null;
  taskRun: TaskRun | null;
  evidence: EvidenceEntry[];
  live?: AutomationRunLiveState;
}

type RunningState = {
  automationRunId?: string;
  queueItemId: string;
  signal: AgentAbortSignal;
  steps: AgentStep[];
  taskRunId?: string;
  progress?: string;
  status: AutomationRunStatus | TaskQueueStatus;
  ask?: PendingAsk;
  approval?: PendingApproval;
  // Linked chat (see chat-bridge): the run narrates into this live message.
  chatSessionId?: string;
  chatMessageId?: string;
};

// In-flight run state MUST survive Vite/Tauri HMR. If these maps were module-level
// they'd reset whenever this file is re-evaluated, orphaning any run that is mid
// agent-loop — the live ask/approval resolve callbacks and step stream vanish, so
// RunMonitor shows "0 steps / waiting user" with no answer box and the run is stuck
// forever. Pin them on globalThis (same pattern as the DB singleton). See memory:
// project_hmr_singleton_gotcha.
type AutomationProcessorGlobals = {
  runningByAutomationRun: Map<string, RunningState>;
  runningByQueueItem: Map<string, RunningState>;
  installed: boolean;
};
const PROC_GLOBAL = globalThis as unknown as { __larundAutomationProc?: AutomationProcessorGlobals };
const procGlobals: AutomationProcessorGlobals = (PROC_GLOBAL.__larundAutomationProc ??= {
  runningByAutomationRun: new Map<string, RunningState>(),
  runningByQueueItem: new Map<string, RunningState>(),
  installed: false,
});
const runningByAutomationRun = procGlobals.runningByAutomationRun;
const runningByQueueItem = procGlobals.runningByQueueItem;
const DEFAULT_AUTOMATION_MODEL = MODELS.find((model) => model.id === 'core')?.openrouter_id ?? 'anthropic/claude-haiku-4-5';

export function configureAutomationQueueProcessor(): void {
  // Deliberately re-register every time. During Vite/Tauri HMR, queue/store can
  // be re-evaluated and fall back to its default processor while this module's
  // installed flag survives. Re-applying the processor makes Run now robust.
  configureTaskQueue({ processor: agentQueueProcessor });
  procGlobals.installed = true;
}

export function ensureAutomationQueueProcessor(): void {
  configureAutomationQueueProcessor();
}

export function isAutomationQueueProcessorInstalled(): boolean {
  return procGlobals.installed;
}

export async function agentQueueProcessor(item: TaskQueueItem): Promise<TaskQueueProcessorResult> {
  const automationRunId = stringMeta(item, 'automationRunId');
  const automationId = stringMeta(item, 'automationId');
  const automationPhase = stringMeta(item, 'automationPhase') === 'setup' ? 'setup' : 'run';
  const sessionId = automationRunId ? `automation:${automationRunId}` : `queue:${item.id}`;
  const signal: AgentAbortSignal = { aborted: false };
  const state: RunningState = {
    automationRunId,
    queueItemId: item.id,
    signal,
    steps: [],
    status: 'running',
    progress: 'Starting agent loop',
  };
  runningByQueueItem.set(item.id, state);
  if (automationRunId) runningByAutomationRun.set(automationRunId, state);

  const automation = automationId ? await getAutomation(automationId) : null;
  const normalized = automation ? normalizeAutomation(automation) : null;

  // Open the linked chat: an automation run writes the same user-facing narrative
  // a chat run does. Best-effort — a missing chat session must never block the run.
  if (automation && automationRunId) {
    const run = await getAutomationRun(automationRunId);
    if (run) {
      const linked = await appendAutomationRunStartedMessage({
        automation,
        run,
        triggerPayload: run.triggerPayload ?? {},
      }).catch(() => null);
      if (linked) {
        state.chatSessionId = linked.sessionId;
        state.chatMessageId = linked.messageId;
      }
    }
  }

  const safetyPolicy = automationPhase === 'setup' && item.metadata?.safetyPolicy
    ? item.metadata.safetyPolicy as NonNullable<typeof normalized>['safetyPolicy']
    : normalized?.safetyPolicy;
  const verificationChecklist = automationPhase === 'setup' && Array.isArray(item.metadata?.verificationChecklist)
    ? item.metadata.verificationChecklist as VerificationCheck[]
    : normalized?.verificationChecklist;
  const policy = safetyPolicy ? riskPolicyForAutomationSafety(safetyPolicy) : undefined;
  const maxToolCalls = safetyPolicy?.maxToolCalls;
  const maxRuntimeMs = safetyPolicy?.maxRuntimeMinutes
    ? safetyPolicy.maxRuntimeMinutes * 60_000
    : undefined;
  let toolCalls = 0;
  let summary: string | undefined;
  let error: string | undefined;
  let timedOut = false;
  const timer = maxRuntimeMs
    ? globalThis.setTimeout(() => {
        timedOut = true;
        signal.aborted = true;
      }, maxRuntimeMs)
    : null;

  try {
    await markRunning(item, state, 'Starting agent loop');
    await runControlLoop(
      item.prompt,
      DEFAULT_AUTOMATION_MODEL,
      item.userId,
      {
        onStatus: (status) => {
          void handleStatus(item, state, status);
        },
        onStep: (step) => {
          state.steps.push(step);
          state.progress = labelForStep(step);
          if (step.type === 'tool_call') {
            toolCalls += 1;
            if (maxToolCalls && toolCalls > maxToolCalls) {
              step.error = `max_tool_calls_exceeded:${maxToolCalls}`;
              signal.aborted = true;
            }
          }
          void syncTaskRunId(item, state);
          void updateQueueItem(item.id, { progress: state.progress, taskRunId: state.taskRunId });
          if (state.chatSessionId) {
            void appendAutomationAgentStepMessage({ sessionId: state.chatSessionId, messageId: state.chatMessageId, steps: state.steps });
          }
        },
        onAskUser: async (question) => {
          await syncTaskRunId(item, state);
          state.status = 'waiting_user';
          await updateQueueItem(item.id, { status: 'waiting_user', progress: 'Waiting for user input', taskRunId: state.taskRunId });
          if (automationRunId) await updateAutomationRun(automationRunId, { status: 'waiting_user', taskRunId: state.taskRunId });
          if (automationId && automationPhase === 'setup') await markAutomationSetupStatus(automationId, 'waiting_user', { taskRunId: state.taskRunId });
          if (state.chatSessionId) {
            await appendAutomationAskUserMessage({ sessionId: state.chatSessionId, messageId: state.chatMessageId, question, steps: state.steps }).catch(() => undefined);
          }
          const answer = await new Promise<string>((resolve) => {
            state.ask = { question, resolve };
          });
          state.ask = undefined;
          await markRunning(item, state, 'Resuming');
          return answer;
        },
        onApproval: async (req) => {
          await syncTaskRunId(item, state);
          state.status = 'waiting_approval';
          await updateQueueItem(item.id, { status: 'waiting_approval', progress: `Approval needed: ${req.action}`, taskRunId: state.taskRunId });
          if (automationRunId) await updateAutomationRun(automationRunId, { status: 'waiting_approval', taskRunId: state.taskRunId });
          if (automationId && automationPhase === 'setup') await markAutomationSetupStatus(automationId, 'waiting_approval', { taskRunId: state.taskRunId });
          if (state.chatSessionId) {
            await appendAutomationApprovalMessage({ sessionId: state.chatSessionId, messageId: state.chatMessageId, approval: req, steps: state.steps }).catch(() => undefined);
          }
          const decision = await new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
            state.approval = { ...req, resolve };
          });
          state.approval = undefined;
          await markRunning(item, state, decision === 'deny' ? 'Approval denied' : 'Approval granted');
          return decision;
        },
        onComplete: (text) => {
          summary = text;
          state.status = 'completed';
          state.progress = text || 'Completed';
        },
        onError: (message) => {
          error = message;
          state.status = 'failed';
          state.progress = 'Failed';
        },
      },
      signal,
      {
        sessionId,
        workspaceId: item.workspaceId,
        references: (item.metadata?.referencedContext as never) ?? [],
        roleId: stringMeta(item, 'roleTemplateId'),
        workflowTemplateId: stringMeta(item, 'workflowTemplateId'),
        policy,
      },
    );

    await syncTaskRunId(item, state);
    if (timer) globalThis.clearTimeout(timer);
    if (signal.aborted) {
      await markCancelled(item, state, timedOut ? 'Automation runtime limit reached.' : 'Automation cancelled.');
      return { taskRunId: state.taskRunId, summary: timedOut ? 'Runtime limit reached.' : 'Cancelled', cancelled: true };
    }
    if (error) throw new Error(error);

    const verification = await enforceAutomationVerification(item, state, verificationChecklist);
    if (!verification.ok) {
      const answer = await requestManualVerification(item, state, verification.reason);
      if (!/^\s*(y|yes|approve|ok|done|confirmed)/i.test(answer)) {
        if (state.taskRunId) await setTaskStatus(state.taskRunId, 'failed', { error: verification.reason });
        throw new Error(verification.reason);
      }
      if (state.taskRunId) await setTaskStatus(state.taskRunId, 'completed', { summary: summary ?? 'Completed after manual verification.' });
    }

    if (automationRunId) await updateAutomationRun(automationRunId, { status: 'completed', taskRunId: state.taskRunId });
    if (automationId && automationPhase === 'setup') {
      const evidence = state.taskRunId ? await listEvidence(state.taskRunId) : [];
      await completeAutomationSetup(automationId, evidence, state.taskRunId);
    } else if (automationId) {
      await recordAutomationRunResult(automationId, 'completed', { taskRunId: state.taskRunId, queueItemId: item.id });
    }
    if (state.chatSessionId) {
      await appendAutomationCompletedMessage({ sessionId: state.chatSessionId, messageId: state.chatMessageId, summary: summary ?? 'Completed.', steps: state.steps }).catch(() => undefined);
    }
    return { taskRunId: state.taskRunId, summary: summary ?? 'Completed' };
  } catch (err) {
    if (automationId && automationPhase === 'setup') {
      const message = err instanceof Error ? err.message : String(err);
      await markAutomationSetupStatus(automationId, 'failed', { taskRunId: state.taskRunId, error: message }).catch(() => undefined);
    }
    if (state.chatSessionId) {
      const message = err instanceof Error ? err.message : String(err);
      await appendAutomationFailedMessage({ sessionId: state.chatSessionId, messageId: state.chatMessageId, error: message, steps: state.steps }).catch(() => undefined);
    }
    throw err;
  } finally {
    if (timer) globalThis.clearTimeout(timer);
    runningByQueueItem.delete(item.id);
    if (automationRunId) runningByAutomationRun.delete(automationRunId);
  }
}

export async function cancelAutomationRun(automationRunId: string): Promise<boolean> {
  const state = runningByAutomationRun.get(automationRunId);
  if (state) {
    state.signal.aborted = true;
    state.ask?.resolve('Stopped by user.');
    state.approval?.resolve('deny');
    await markCancelledById(automationRunId, state);
    return true;
  }
  const run = await getAutomationRun(automationRunId);
  if (!run) return false;
  if (!isTerminal(run.status)) {
    await updateAutomationRun(automationRunId, { status: 'cancelled' });
    if (run.queueItemId) await updateQueueItem(run.queueItemId, { status: 'cancelled', completedAt: new Date().toISOString(), progress: 'Cancelled' });
    if (run.taskRunId) await setTaskStatus(run.taskRunId, 'cancelled');
  }
  return true;
}

export function answerAutomationRun(automationRunId: string, answer: string): boolean {
  const state = runningByAutomationRun.get(automationRunId);
  if (!state?.ask) return false;
  state.ask.resolve(answer);
  state.ask = undefined;
  return true;
}

export function resolveAutomationApproval(
  automationRunId: string,
  decision: 'allow_once' | 'allow_always' | 'deny',
): boolean {
  const state = runningByAutomationRun.get(automationRunId);
  if (!state?.approval) return false;
  state.approval.resolve(decision);
  state.approval = undefined;
  return true;
}

export async function getAutomationRunSnapshot(automationRunId: string): Promise<AutomationRunSnapshot> {
  const run = await getAutomationRun(automationRunId);
  const liveState = runningByAutomationRun.get(automationRunId);
  const queueItem = run?.queueItemId ? await getQueueItem(run.queueItemId) : liveState ? await getQueueItem(liveState.queueItemId) : null;
  const taskRunId = liveState?.taskRunId ?? run?.taskRunId ?? queueItem?.taskRunId ?? await taskRunIdForSession(`automation:${automationRunId}`);
  const taskRun = taskRunId ? await getTaskRun(taskRunId) : null;
  const evidence = taskRunId ? await listEvidence(taskRunId) : [];
  return {
    run,
    queueItem,
    taskRun,
    evidence,
    live: liveState ? liveStateToSnapshot(liveState) : undefined,
  };
}

async function enforceAutomationVerification(
  item: TaskQueueItem,
  state: RunningState,
  checklist?: VerificationCheck[],
): Promise<{ ok: boolean; reason: string }> {
  await syncTaskRunId(item, state);
  const evidence = state.taskRunId ? await listEvidence(state.taskRunId) : [];
  const result = verifyAutomationEvidence(checklist, evidence);
  return { ok: result.ok, reason: result.reason };
}

async function requestManualVerification(item: TaskQueueItem, state: RunningState, reason: string): Promise<string> {
  const automationRunId = state.automationRunId;
  state.status = 'waiting_user';
  await updateQueueItem(item.id, { status: 'waiting_user', progress: reason, taskRunId: state.taskRunId });
  if (automationRunId) await updateAutomationRun(automationRunId, { status: 'waiting_user', taskRunId: state.taskRunId });
  if (state.taskRunId) await setTaskStatus(state.taskRunId, 'needs_input', { error: reason });
  await createNotification({
    userId: item.userId,
    workspaceId: item.workspaceId,
    kind: 'approval_needed',
    title: 'Automation verification needed',
    body: reason,
    metadata: { automationRunId, queueItemId: item.id, taskRunId: state.taskRunId },
  });
  return new Promise<string>((resolve) => {
    state.ask = {
      question: `${reason}\nConfirm the result manually to complete this automation.`,
      resolve,
    };
  });
}

async function handleStatus(item: TaskQueueItem, state: RunningState, status: AgentStatus): Promise<void> {
  const automationId = stringMeta(item, 'automationId');
  const automationPhase = stringMeta(item, 'automationPhase') === 'setup' ? 'setup' : 'run';
  if (status === 'waiting_user') return;
  if (status === 'error') {
    state.status = 'failed';
    await updateQueueItem(item.id, { status: 'failed', progress: 'Failed', taskRunId: state.taskRunId });
    if (state.automationRunId) await updateAutomationRun(state.automationRunId, { status: 'failed', taskRunId: state.taskRunId });
    if (automationId && automationPhase === 'setup') await markAutomationSetupStatus(automationId, 'failed', { taskRunId: state.taskRunId });
    return;
  }
  if (status === 'complete') return;
  await markRunning(item, state, status === 'planning' ? 'Planning' : 'Executing');
}

async function markRunning(item: TaskQueueItem, state: RunningState, progress: string): Promise<void> {
  // Never resurrect a run that was already cancelled. Cancellation can land in
  // the startup window (the runner marks the run 'running' before the processor
  // begins), and a late markRunning would flip the queue item back to running.
  if (state.signal.aborted) return;
  state.status = 'running';
  state.progress = progress;
  await syncTaskRunId(item, state);
  await updateQueueItem(item.id, { status: 'running', progress, taskRunId: state.taskRunId });
  if (state.automationRunId) await updateAutomationRun(state.automationRunId, { status: 'running', taskRunId: state.taskRunId });
  const automationId = stringMeta(item, 'automationId');
  if (automationId && stringMeta(item, 'automationPhase') === 'setup') await markAutomationSetupStatus(automationId, 'running', { taskRunId: state.taskRunId });
}

async function markCancelledById(automationRunId: string, state: RunningState): Promise<void> {
  await updateAutomationRun(automationRunId, { status: 'cancelled', taskRunId: state.taskRunId });
  await updateQueueItem(state.queueItemId, { status: 'cancelled', completedAt: new Date().toISOString(), progress: 'Cancelled', taskRunId: state.taskRunId });
  const run = await getAutomationRun(automationRunId);
  if (run?.triggerPayload?.automationPhase === 'setup') await markAutomationSetupStatus(run.automationId, 'cancelled', { taskRunId: state.taskRunId });
  if (state.taskRunId) await setTaskStatus(state.taskRunId, 'cancelled');
}

async function markCancelled(item: TaskQueueItem, state: RunningState, reason: string): Promise<void> {
  state.status = 'cancelled';
  state.progress = reason;
  await syncTaskRunId(item, state);
  await updateQueueItem(item.id, { status: 'cancelled', completedAt: new Date().toISOString(), progress: reason, taskRunId: state.taskRunId });
  if (state.automationRunId) await updateAutomationRun(state.automationRunId, { status: 'cancelled', taskRunId: state.taskRunId });
  const automationId = stringMeta(item, 'automationId');
  if (automationId && stringMeta(item, 'automationPhase') === 'setup') await markAutomationSetupStatus(automationId, 'cancelled', { taskRunId: state.taskRunId });
  if (state.taskRunId) await setTaskStatus(state.taskRunId, 'cancelled');
}

async function syncTaskRunId(item: TaskQueueItem, state: RunningState): Promise<void> {
  if (state.taskRunId) return;
  const taskRunId = await taskRunIdForSession(state.automationRunId ? `automation:${state.automationRunId}` : `queue:${item.id}`, item.userId);
  if (taskRunId) {
    state.taskRunId = taskRunId;
    await updateQueueItem(item.id, { taskRunId });
    if (state.automationRunId) await updateAutomationRun(state.automationRunId, { taskRunId });
  }
}

async function taskRunIdForSession(sessionId: string, userId?: string): Promise<string | undefined> {
  const runs = await listTaskRuns({ userId: userId ?? '' });
  return runs.find((run) => run.sessionId === sessionId)?.id;
}

function liveStateToSnapshot(state: RunningState): AutomationRunLiveState {
  return {
    automationRunId: state.automationRunId,
    queueItemId: state.queueItemId,
    taskRunId: state.taskRunId,
    status: state.status,
    progress: state.progress,
    steps: [...state.steps],
    ask: state.ask ? { question: state.ask.question } : undefined,
    approval: state.approval ? {
      action: state.approval.action,
      risk: state.approval.risk,
      reason: state.approval.reason,
      argsSummary: state.approval.argsSummary,
    } : undefined,
  };
}

function stringMeta(item: TaskQueueItem, key: string): string | undefined {
  const value = item.metadata?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function labelForStep(step: AgentStep): string {
  if (step.type === 'tool_call') return `Calling ${step.tool ?? 'tool'}`;
  if (step.type === 'tool_result') return `Completed ${step.tool ?? 'tool'}`;
  if (step.type === 'approval') return `Approval needed: ${step.tool ?? 'action'}`;
  if (step.type === 'verification') return step.error ? 'Verification failed' : 'Verifying';
  if (step.type === 'error') return step.error ?? 'Error';
  if (step.output) return step.output.slice(0, 120);
  return step.type.replace('_', ' ');
}

function isTerminal(status: AutomationRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'skipped';
}
