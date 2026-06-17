import { emit } from '@tauri-apps/api/event';
import { callOpenRouterWithTools, type MessageContent } from '../openrouter';
import { supabase } from '../supabase';
import { CONTROL_SYSTEM_PROMPT } from './prompt';
import { parseControlAction, isLegacyVisualActionName } from './parser';
import type { ControlAction } from './types';
import { runControlAction } from '../tools/run';
import { MemoryAuditLogger } from '../tools/audit';
import { PromptApprovalService } from '../tools/approvals';
import { DEFAULT_POLICY, type RiskPolicy } from '../tools/policy';
import { toolCatalogSummary } from '../tools/registry';
import type { AuditEntry, ConnectionRegistry, SkillRunner, WorkflowRunner } from '../tools/types';
import { createConnectionRegistry } from '../connections/registry';
import { createSkillRunner } from '../skills/runner';
import { createWorkflowRunner } from '../workflows/runner';
import { resolveActiveTask, setActiveTask } from '../agent-state/session-memory';
import { renderTaskStatePrompt, recordFailedAttempt } from '../agent-state/task-state';
import type { RecentAction } from '../agent-state/types';
import { verifyBeforeComplete, rejectionMessage } from './completion-guard';
import { detectPageState } from '../browser-workflows/detect-page-state';
import { manualHandoffMessage } from '../browser-workflows/manual-blockers';
import { sanitizeArgs } from '../tools/audit';
import type { DocumentReference } from '../references/types';
import { ingestReferences, buildReferenceMessageContent } from '../references/ingest';
import type { ReferencedContext } from '../mentions/types';
import { resolveReferencedContext } from '../mentions/resolve';
import {
  buildCoworkerPromptContext,
  recordMemoryUsage,
  startTaskTracker,
  type TaskTracker,
} from '../coworker/run-context';
import { blockedStatusFor } from '../tasks/evidence';

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'waiting_user' | 'complete' | 'error';
export type AutonomyMode = 'full' | 'semi' | 'manual';

export interface AgentStep {
  id: string;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error' | 'approval' | 'plan' | 'checklist' | 'verification' | 'handoff' | 'blocked';
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  timestamp: string;
  risk?: string;
  details?: Record<string, unknown>;
}

export interface AgentLoopCallbacks {
  onStatus: (status: AgentStatus) => void;
  onStep: (step: AgentStep) => void;
  onAskUser: (question: string) => Promise<string>;
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
  /** Optional dedicated approval prompt. Falls back to onAskUser yes/no. */
  onApproval?: (req: { action: string; risk: string; reason: string; argsSummary: string }) => Promise<'allow_once' | 'allow_always' | 'deny'>;
  onAudit?: (entry: AuditEntry) => void;
}

export interface AgentAbortSignal {
  aborted: boolean;
}

export interface RunOptions {
  policy?: RiskPolicy;
  sessionId?: string;
  /** Active workspace for this run. Falls back to the user's default workspace. */
  workspaceId?: string;
  /** Optional role template id shaping the prompt + skill ranking. */
  roleId?: string;
  /** Optional workflow template id whose steps/verification guide the run. */
  workflowTemplateId?: string;
  workspaceRoot?: string;
  connections?: ConnectionRegistry;
  skills?: SkillRunner;
  workflows?: WorkflowRunner;
  /** Prior conversation turns, oldest first. Gives the loop real context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  references?: ReferencedContext[];
}

/** How many prior turns to feed into the prompt window. */
const HISTORY_WINDOW = 8;

const MAX_ITERATIONS = 40;

function nowStepId(suffix: string): string {
  return `step-${Date.now()}-${suffix}`;
}

function coerceRows(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell)));
  return rows.length ? rows : undefined;
}

function valuesFromRows(rows: string[][]): string[] {
  return rows.flat().map((cell) => cell.trim()).filter(Boolean);
}

function tsvRows(text: string): string[][] | undefined {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  return rows.length ? rows : undefined;
}

function rememberExpectedSheetData(taskState: import('../agent-state/types').ActiveTaskState, action: ControlAction): void {
  if (action.action === 'connection.call' && /google\.sheets\.(write_values|append_values)/i.test(action.tool)) {
    const rows = coerceRows(action.args.values ?? action.args.rows);
    if (rows) {
      taskState.expectedData = { rows, values: valuesFromRows(rows), source: action.tool };
      const artifact = taskState.expectedArtifacts?.find((a) => a.type === 'table');
      if (artifact) {
        artifact.rows = rows;
        artifact.values = valuesFromRows(rows);
      }
    }
  }
  if (action.action === 'browser.paste' && typeof action.text === 'string') {
    const rows = tsvRows(action.text);
    if (rows) taskState.expectedData = { rows, values: valuesFromRows(rows), source: 'browser.paste' };
  }
  if (action.action === 'clipboard.set') {
    const rows = tsvRows(action.text);
    if (rows) taskState.expectedData = { rows, values: valuesFromRows(rows), source: 'clipboard.set' };
  }
  if (action.action === 'connection.call' && /google\.docs\.(insert_text|batch_update)/i.test(action.tool)) {
    const values: string[] = [];
    if (typeof action.args.text === 'string') values.push(action.args.text);
    const requests = action.args.requests;
    if (Array.isArray(requests)) {
      for (const request of requests) {
        const text = (request as { insertText?: { text?: unknown } })?.insertText?.text;
        if (typeof text === 'string') values.push(text);
      }
    }
    const compact = values.map((v) => v.trim()).filter(Boolean);
    if (compact.length) taskState.expectedData = { values: compact, source: action.tool };
  }
  if ((action.action === 'doc.write_docx' || action.action === 'doc.write_txt') && typeof action.content === 'string') {
    const parts = action.content
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 2)
      .slice(0, 8);
    if (parts.length) taskState.expectedData = { values: parts, source: action.action };
  }
}

async function updateOverlay(state: object): Promise<void> {
  try { await emit('agent-overlay-update', state); } catch { /* optional */ }
}

async function finalDeduct(userId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0 || !userId) return;
  try {
    await supabase.rpc('deduct_uc_credits', { p_user_id: userId, p_cost_usd: costUsd });
  } catch (err) {
    console.warn('Agent credit deduction failed:', err);
  }
}

async function completeStopped(
  onStatus: AgentLoopCallbacks['onStatus'],
  onComplete: AgentLoopCallbacks['onComplete'],
  tracker?: TaskTracker,
): Promise<void> {
  await tracker?.setStatus('cancelled');
  await updateOverlay({ active: false, status: 'complete' });
  onStatus('complete');
  onComplete('Stopped.');
}

export async function runControlLoop(
  task: string,
  modelId: string,
  userId: string,
  callbacks: AgentLoopCallbacks,
  signal?: AgentAbortSignal,
  opts: RunOptions = {},
): Promise<void> {
  const { onStatus, onStep, onAskUser, onComplete, onError } = callbacks;
  const steps: AgentStep[] = [];
  // Mutable task tracker: starts as a no-op and is replaced once the persistent
  // TaskRun is created. emitStep persists each step as evidence (best-effort).
  let tracker: TaskTracker = { taskRunId: undefined, async recordStep() {}, async setStatus() {} };
  const emitStep = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
    void tracker.recordStep(step);
  };

  let totalCostUsd = 0;
  const policy = opts.policy ?? DEFAULT_POLICY;
  const sessionId = opts.sessionId ?? `sess-${Date.now()}`;
  const references = opts.references ?? [];

  // Resolve workspace context (workspace summary + relevant memory + skills) and
  // start persistent task tracking. All best-effort: failures never block the run.
  const coworker = await buildCoworkerPromptContext({
    userId, sessionId, task,
    workspaceId: opts.workspaceId,
    roleId: opts.roleId,
    workflowTemplateId: opts.workflowTemplateId,
  });
  const workspaceRoot = opts.workspaceRoot ?? coworker.workspaceRoot ?? '~';
  tracker = await startTaskTracker({
    userId,
    workspaceId: coworker.workspace?.id ?? opts.workspaceId,
    sessionId,
    task,
    modelId,
    autonomyMode: coworker.workspace?.autonomyMode ?? 'semi',
    roleId: coworker.roleId,
    workflowTemplateId: coworker.workflowTemplateId,
  });

  const audit = new MemoryAuditLogger((entry) => callbacks.onAudit?.(entry));
  const approvals = new PromptApprovalService(async (req) => {
    if (callbacks.onApproval) {
      return callbacks.onApproval({ action: req.action.action, risk: req.risk, reason: req.reason, argsSummary: req.argsSummary });
    }
    emitStep({ id: nowStepId('approval'), type: 'approval', tool: req.action.action, risk: req.risk, output: req.reason, timestamp: new Date().toISOString() });
    const answer = await onAskUser(`Approval needed for ${req.action.action} (${req.risk}). ${req.reason}\nArgs: ${req.argsSummary}\nReply "yes" to allow.`);
    return /^\s*(y|yes|allow|ok)/i.test(answer) ? 'allow_once' : 'deny';
  }, 'deny', {
    userId,
    workspaceId: coworker.workspace?.id ?? opts.workspaceId,
    taskRunId: tracker.taskRunId,
  });

  const connections = opts.connections ?? createConnectionRegistry(userId);
  // Scope the skill runner to the resolved workspace so enabled user/workspace
  // builder skills (Phase 2) are runnable alongside the bundled ones.
  const skills = opts.skills ?? createSkillRunner({ userId, workspaceId: coworker.workspace?.id ?? opts.workspaceId });
  const workflows = opts.workflows ?? createWorkflowRunner();

  onStatus('planning');
  emitStep({
    id: nowStepId('mode'),
    type: 'plan',
    output: 'No-mouse operator. Working via CLI, files, browser DOM, apps, connections and skills. No mouse/cursor/visual control.',
    timestamp: new Date().toISOString(),
  });
  await updateOverlay({ active: true, status: 'planning', task, steps });

  // ── Persistent task / context memory ──────────────────────────────────────
  // Resolve the active task for this session: a correction/continuation folds
  // into the prior task; otherwise a fresh task is classified by preflight.
  const resolved = resolveActiveTask(sessionId, task);
  const taskState = resolved.state;
  taskState.status = 'running';
  const resolvedReferences = references.length
    ? await resolveReferencedContext({
        references,
        userId,
        workspaceId: coworker.workspace?.id ?? opts.workspaceId,
      })
    : { promptBlock: '', blockers: [], documentReferences: [] as DocumentReference[] };

  if (resolvedReferences.blockers.length) {
    const message = `Referenced context is not ready:\n${resolvedReferences.blockers.map((b) => `- ${b}`).join('\n')}`;
    emitStep({ id: nowStepId('reference-blocker'), type: 'blocked', output: message, timestamp: new Date().toISOString() });
    await tracker.setStatus('blocked', { error: message });
    onError(message);
    await updateOverlay({ active: false, status: 'error' });
    return;
  }

  taskState.referencedInputs = resolvedReferences.documentReferences;
  const ctx = { userId, sessionId, workspaceRoot, task, references: resolvedReferences.documentReferences, audit, approvals, connections, skills, workflows, onAskUser, addCost: (usd: number) => { totalCostUsd += usd; } };
  if (resolved.isCorrection) {
    emitStep({
      id: nowStepId('correction'),
      type: 'thinking',
      output: `Correction detected — continuing the active task: ${taskState.currentGoal}`,
      timestamp: new Date().toISOString(),
    });
  }

  const recentActions: RecentAction[] = [];
  const MAX_RECENT = 40;
  const recordAction = (rec: RecentAction) => {
    recentActions.push(rec);
    if (recentActions.length > MAX_RECENT) recentActions.shift();
  };

  // Read attached references into model-ready content (text + image blocks).
  // Shared with the normal chat path via ../references/ingest.
  const ingest = resolvedReferences.documentReferences.length > 0 ? await ingestReferences(resolvedReferences.documentReferences, task) : null;
  if (ingest) {
    emitStep({
      id: nowStepId('refs-plan'),
      type: 'checklist',
      output: `Referenced inputs: ${resolvedReferences.documentReferences.map((ref) => ref.label).join(', ')}. I will inspect them before using their contents.`,
      timestamp: new Date().toISOString(),
    });
    for (const item of ingest.perRef) {
      const tool = item.kind === 'folder' ? 'folder.scan' : 'document.read';
      emitStep({
        id: nowStepId(item.kind === 'folder' ? 'folder-scan' : 'document-read'),
        type: item.ok ? 'verification' : 'error',
        tool,
        input: JSON.stringify(item.ref),
        output: item.output,
        error: item.error,
        timestamp: new Date().toISOString(),
        details: item.kind === 'folder' ? { folderScan: item.folderScan } : { documentRead: item.documentRead },
      });
      recordAction({ action: tool, argsSummary: JSON.stringify(item.ref), success: item.ok, output: item.output, error: item.error });
    }
    if (ingest.filesRead.length) {
      taskState.filesRead = [...(taskState.filesRead ?? []), ...ingest.filesRead];
    }
    setActiveTask(sessionId, taskState);
  }

  const history = (opts.history ?? []).slice(-HISTORY_WINDOW);
  const historyBlock = history.length
    ? `\n\n## Recent conversation\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : '';

  const coworkerBlock = [coworker.promptBlock, resolvedReferences.promptBlock].filter(Boolean).join('\n\n');
  const coworkerPromptBlock = coworkerBlock ? `\n\n${coworkerBlock}` : '';
  const systemPrompt =
    `${CONTROL_SYSTEM_PROMPT}\n\n## Tool catalog\n${toolCatalogSummary()}\n\n## Workspace\n${workspaceRoot}${coworkerPromptBlock}` +
    `${historyBlock}\n\n${renderTaskStatePrompt(taskState)}\n\n## Current message\n${task}`;

  // Surfaced memory counts as used (drives recency boost), fire-and-forget.
  void recordMemoryUsage(coworker.usedMemoryIds);

  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  // Inject the actual contents of attached references (text + images) so the
  // model can analyze them directly instead of only seeing their labels.
  const refContent = ingest ? buildReferenceMessageContent(ingest) : null;
  if (refContent) {
    messages.push({ role: 'user', content: refContent });
  }

  // Rolling record of executed actions — the evidence the completion guard checks.
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }

    onStatus('executing');
    await updateOverlay({ active: true, status: 'executing', task, steps });

    let aiResponse = '';
    let streamError = '';
    const streamController = new AbortController();
    const abortPoll = globalThis.setInterval(() => {
      if (signal?.aborted) streamController.abort();
    }, 60);
    try {
      await callOpenRouterWithTools(
        messages, modelId, userId,
        (chunk) => { aiResponse += chunk; },
        (usage) => { totalCostUsd += usage.costUsd; },
        (err) => { streamError = err; },
        false,
        streamController.signal,
      );
    } finally {
      globalThis.clearInterval(abortPoll);
    }
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }
    if (streamError) { await tracker.setStatus('failed', { error: streamError }); onError(streamError); await updateOverlay({ active: false }); return; }

    // Reject any retired mouse/cursor/visual action by name before parsing.
    const attempted = aiResponse.match(/"(?:action|tool)"\s*:\s*"([^"]+)"/)?.[1] ?? '';
    if (attempted && isLegacyVisualActionName(attempted)) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `Rejected "${attempted}": this is a no-mouse operator. There is no mouse/cursor/visual control. Use CLI, files, browser DOM, connections, skills — or ask_user for a manual handoff.` });
      emitStep({ id: nowStepId('legacy-blocked'), type: 'error', tool: attempted, error: 'mouse_cursor_visual_not_supported', timestamp: new Date().toISOString() });
      continue;
    }

    const action = parseControlAction(aiResponse);
    if (!action) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: 'Invalid action JSON. Return exactly one allowed action object with an "action" field.' });
      emitStep({ id: nowStepId('parse-error'), type: 'error', error: 'invalid_control_action', output: aiResponse.slice(0, 500), timestamp: new Date().toISOString() });
      continue;
    }

    const stepId = nowStepId('action');
    emitStep({ id: stepId, type: 'tool_call', tool: action.action, input: JSON.stringify(action, null, 2), timestamp: new Date().toISOString() });

    if (action.action === 'ask_user') {
      onStatus('waiting_user');
      taskState.status = 'waiting_user';
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('needs_input');
      const answer = await onAskUser(action.question);
      if (signal?.aborted) {
        await completeStopped(onStatus, onComplete, tracker);
        return;
      }
      taskState.status = 'running';
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('running');
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `User answered: ${answer}\nResume the SAME active task with the same goal.` });
      continue;
    }

    if (action.action === 'task.complete') {
      // Completion guard: do not close the run unless the requested outcome is
      // actually proven by the recorded evidence. On reject, keep looping.
      const guard = verifyBeforeComplete(taskState, recentActions);
      emitStep({
        id: nowStepId('verification'),
        type: 'verification',
        tool: 'task.complete',
        output: guard.ok ? `Verification passed: ${guard.reason}` : `Verification failed: ${guard.reason}`,
        error: guard.ok ? undefined : 'completion_rejected',
        timestamp: new Date().toISOString(),
      });
      if (!guard.ok) {
        recordFailedAttempt(taskState, {
          step: 'task.complete',
          reason: guard.reason,
          tool: 'task.complete',
        });
        setActiveTask(sessionId, taskState);
        emitStep({
          id: nowStepId('complete-rejected'),
          type: 'error',
          tool: 'task.complete',
          error: 'completion_rejected',
          output: guard.reason,
          timestamp: new Date().toISOString(),
        });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({ role: 'user', content: rejectionMessage(guard) });
        continue;
      }
      taskState.status = 'complete';
      taskState.completedChecks = [...taskState.pendingChecks];
      taskState.pendingChecks = [];
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('completed', { summary: action.summary });
      await finalDeduct(userId, totalCostUsd);
      emitStep({ id: nowStepId('complete'), type: 'complete', output: action.summary, timestamp: new Date().toISOString() });
      await updateOverlay({ active: false, status: 'complete', task, steps });
      onStatus('complete');
      onComplete(action.summary);
      return;
    }

    const result = await runControlAction(action as ControlAction, ctx, policy);
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }

    emitStep({
      id: `${stepId}-result`,
      type: result.success ? 'tool_result' : 'error',
      tool: action.action,
      output: result.output,
      error: result.error,
      timestamp: new Date().toISOString(),
      details: result.details,
    });
    await updateOverlay({ active: true, status: 'executing', task, steps });

    // Record evidence for the completion guard.
    rememberExpectedSheetData(taskState, action as ControlAction);
    setActiveTask(sessionId, taskState);
    recordAction({
      action: action.action,
      argsSummary: sanitizeArgs(action),
      success: result.success,
      output: result.output,
      error: result.error,
    });

    // Browser state awareness: when a page read reveals a login / CAPTCHA wall,
    // mark the task blocked and steer the model to a manual handoff (not failure).
    let blockerNote = '';
    if (result.success && (action.action === 'browser.read' || action.action === 'browser.get_state' || action.action === 'browser.open')) {
      const pageState = detectPageState(result.output);
      taskState.lastKnownState = `${pageState.kind}${pageState.url ? ` @ ${pageState.url}` : ''}`;
      if (pageState.isManualBlocker) {
        taskState.status = 'blocked';
        const blocker = pageState.kind === 'login_required' ? 'login' : pageState.kind === 'captcha' ? 'captcha' : 'permission';
        await tracker.setStatus(blockedStatusFor(blocker));
        blockerNote = `\nMANUAL BLOCKER (${pageState.kind}). Do NOT complete. ask_user: "${manualHandoffMessage(pageState.kind === 'login_required' ? 'login_required' : pageState.kind === 'captcha' ? 'captcha' : 'permission_required')}" Then resume the same task.`;
      }
      setActiveTask(sessionId, taskState);
    }

    messages.push({ role: 'assistant', content: aiResponse });
    messages.push({
      role: 'user',
      content: result.success
        ? `Action result: ${result.output}${blockerNote}\nComplete with task.complete only when the result is verified by a read-back and proves the requested outcome.`
        : `Action error: ${result.error ?? result.output}\nPick a different structured tool. Mouse/cursor/visual control is unavailable. If only a GUI mouse path exists, ask_user for a manual step or an API/export alternative.`,
    });
  }

  await tracker.setStatus('failed', { error: `Reached maximum iterations (${MAX_ITERATIONS})` });
  await finalDeduct(userId, totalCostUsd);
  await updateOverlay({ active: false });
  onError(`Reached maximum iterations (${MAX_ITERATIONS})`);
}
