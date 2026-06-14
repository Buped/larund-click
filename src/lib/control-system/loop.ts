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

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'waiting_user' | 'complete' | 'error';
export type AutonomyMode = 'full' | 'semi' | 'manual';

export interface AgentStep {
  id: string;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error' | 'approval';
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
  workspaceRoot?: string;
  connections?: ConnectionRegistry;
  skills?: SkillRunner;
  workflows?: WorkflowRunner;
}

const MAX_ITERATIONS = 40;

function nowStepId(suffix: string): string {
  return `step-${Date.now()}-${suffix}`;
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
): Promise<void> {
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
  const emitStep = (step: AgentStep) => { steps.push(step); onStep(step); };

  let totalCostUsd = 0;
  const policy = opts.policy ?? DEFAULT_POLICY;
  const sessionId = opts.sessionId ?? `sess-${Date.now()}`;
  const workspaceRoot = opts.workspaceRoot ?? '~';

  const audit = new MemoryAuditLogger((entry) => callbacks.onAudit?.(entry));
  const approvals = new PromptApprovalService(async (req) => {
    if (callbacks.onApproval) {
      return callbacks.onApproval({ action: req.action.action, risk: req.risk, reason: req.reason, argsSummary: req.argsSummary });
    }
    emitStep({ id: nowStepId('approval'), type: 'approval', tool: req.action.action, risk: req.risk, output: req.reason, timestamp: new Date().toISOString() });
    const answer = await onAskUser(`Approval needed for ${req.action.action} (${req.risk}). ${req.reason}\nArgs: ${req.argsSummary}\nReply "yes" to allow.`);
    return /^\s*(y|yes|allow|ok)/i.test(answer) ? 'allow_once' : 'deny';
  });

  const connections = opts.connections ?? createConnectionRegistry(userId);
  const skills = opts.skills ?? createSkillRunner();
  const workflows = opts.workflows ?? createWorkflowRunner();

  const ctx = { userId, sessionId, workspaceRoot, task, audit, approvals, connections, skills, workflows, onAskUser, addCost: (usd: number) => { totalCostUsd += usd; } };

  onStatus('planning');
  emitStep({
    id: nowStepId('mode'),
    type: 'thinking',
    output: 'No-mouse operator. Working via CLI, files, browser DOM, apps, connections and skills. No mouse/cursor/visual control.',
    timestamp: new Date().toISOString(),
  });
  await updateOverlay({ active: true, status: 'planning', task, steps });

  const systemPrompt = `${CONTROL_SYSTEM_PROMPT}\n\n## Tool catalog\n${toolCatalogSummary()}\n\n## Workspace\n${workspaceRoot}\n\n## Task\n${task}`;
  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete);
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
      await completeStopped(onStatus, onComplete);
      return;
    }
    if (streamError) { onError(streamError); await updateOverlay({ active: false }); return; }

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
      const answer = await onAskUser(action.question);
      if (signal?.aborted) {
        await completeStopped(onStatus, onComplete);
        return;
      }
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `User answered: ${answer}` });
      continue;
    }

    if (action.action === 'task.complete') {
      await finalDeduct(userId, totalCostUsd);
      emitStep({ id: nowStepId('complete'), type: 'complete', output: action.summary, timestamp: new Date().toISOString() });
      await updateOverlay({ active: false, status: 'complete', task, steps });
      onStatus('complete');
      onComplete(action.summary);
      return;
    }

    const result = await runControlAction(action as ControlAction, ctx, policy);
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete);
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

    messages.push({ role: 'assistant', content: aiResponse });
    messages.push({
      role: 'user',
      content: result.success
        ? `Action result: ${result.output}\nComplete with task.complete only when this proves the requested outcome.`
        : `Action error: ${result.error ?? result.output}\nPick a different structured tool. Mouse/cursor/visual control is unavailable. If only a GUI mouse path exists, ask_user for a manual step or an API/export alternative.`,
    });
  }

  await finalDeduct(userId, totalCostUsd);
  await updateOverlay({ active: false });
  onError(`Reached maximum iterations (${MAX_ITERATIONS})`);
}
