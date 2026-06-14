import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { callOpenRouterWithTools, type MessageContent } from '../openrouter';
import { supabase } from '../supabase';
import { CONTROL_SYSTEM_PROMPT } from './prompt';
import { executeControlAction } from './executor';
import { isRawMouseActionName, parseControlAction } from './parser';
import type { ControlAction } from './types';

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'waiting_user' | 'complete' | 'error';
export type AutonomyMode = 'full' | 'semi' | 'manual';

export interface AgentStep {
  id: string;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error';
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  timestamp: string;
  screenshotBase64?: string;
  details?: Record<string, unknown>;
}

export interface AgentLoopCallbacks {
  onStatus: (status: AgentStatus) => void;
  onStep: (step: AgentStep) => void;
  onAskUser: (question: string) => Promise<string>;
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
}

export interface AgentAbortSignal {
  aborted: boolean;
}

const MAX_ITERATIONS = 40;

function nowStepId(suffix: string): string {
  return `step-${Date.now()}-${suffix}`;
}

async function updateOverlay(state: object): Promise<void> {
  try { await emit('agent-overlay-update', state); } catch { /* optional */ }
}

async function minimizeMainWindow(): Promise<void> {
  try { await invoke('minimize_main_window'); } catch { /* optional */ }
}

async function restoreMainWindow(): Promise<void> {
  try { await invoke('restore_main_window'); } catch { /* optional */ }
}

async function guardStart(): Promise<void> {
  try { await invoke('input_guard_start'); } catch { /* optional */ }
}

async function guardStop(): Promise<void> {
  try { await invoke('input_guard_stop'); } catch { /* optional */ }
}

async function guardPause(): Promise<void> {
  try { await invoke('input_guard_pause'); } catch { /* optional */ }
}

async function guardSetBlock(on: boolean): Promise<void> {
  try { await invoke('input_guard_set_block', { on }); } catch { /* optional */ }
}

async function sendRunningNotification(): Promise<void> {
  try {
    await invoke('send_notification', {
      title: 'Larund Click',
      message: 'Az AI most a kepernyot vezerli - nyomj ESC-et a leallitashoz.',
    });
  } catch { /* optional */ }
}

async function finalDeduct(userId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  try {
    await supabase.rpc('deduct_uc_credits', { p_user_id: userId, p_cost_usd: costUsd });
  } catch (err) {
    console.warn('Agent credit deduction failed:', err);
  }
}

// Actions that act on the live foreground desktop: minimize our chat window and
// engage the input guard. Browser (CDP), data I/O, and window.list need neither.
function actionTouchesScreen(action: ControlAction): boolean {
  return action.action === 'app.open'
    || action.action === 'window.focus'
    || action.action === 'ui.read'
    || action.action === 'ui.invoke'
    || action.action === 'ui.click'
    || action.action === 'ui.type'
    || action.action === 'ui.scroll'
    || action.action === 'ui.focusNext'
    || action.action === 'ui.activate'
    || action.action === 'visual.clickIntent'
    || action.action === 'visual.typeIntent'
    || action.action === 'keyboard.press'
    || action.action === 'keyboard.combo';
}

// Actions that inject mouse/keyboard input: block physical input during the burst.
function actionInjectsInput(action: ControlAction): boolean {
  return action.action === 'ui.invoke'
    || action.action === 'ui.click'
    || action.action === 'ui.type'
    || action.action === 'ui.scroll'
    || action.action === 'ui.activate'
    || action.action === 'visual.clickIntent'
    || action.action === 'visual.typeIntent'
    || action.action === 'keyboard.press'
    || action.action === 'keyboard.combo';
}

export async function runControlLoop(
  task: string,
  modelId: string,
  userId: string,
  callbacks: AgentLoopCallbacks,
  signal?: AgentAbortSignal,
  _autonomyMode: AutonomyMode = 'semi',
): Promise<void> {
  const { onStatus, onStep, onAskUser, onComplete, onError } = callbacks;
  const steps: AgentStep[] = [];
  const emitStep = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
  };

  let totalCostUsd = 0;
  let screenPrepared = false;
  let lastSuccessfulAction = '';

  const cleanup = async () => {
    await guardStop();
    if (screenPrepared) await restoreMainWindow();
    await updateOverlay({ active: false, status: 'idle', task, steps });
  };

  const ensureScreenPrepared = async () => {
    if (screenPrepared) return;
    screenPrepared = true;
    await minimizeMainWindow();
    await guardStart();
    await sendRunningNotification();
    await new Promise((resolve) => setTimeout(resolve, 600));
  };

  onStatus('planning');
  emitStep({
    id: nowStepId('mode'),
    type: 'thinking',
    output: 'Feladat modja: CLI-first vezerles. Minden reszfeladat a legmagasabb determinisztikus retegen (CLI / fajl / bongeszo-CDP / UIA); a kurzoros vizio csak vegso tartalek.',
    timestamp: new Date().toISOString(),
  });
  await updateOverlay({ active: true, status: 'planning', task, steps });

  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    { role: 'system', content: `${CONTROL_SYSTEM_PROMPT}\n\nTask: ${task}` },
    { role: 'user', content: task },
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      await cleanup();
      onError('Task stopped by user.');
      return;
    }

    onStatus('executing');
    await updateOverlay({ active: true, status: 'executing', task, steps });

    let aiResponse = '';
    let streamError = '';
    await callOpenRouterWithTools(
      messages,
      modelId,
      userId,
      (chunk) => { aiResponse += chunk; },
      (usage) => { totalCostUsd += usage.costUsd; },
      (err) => { streamError = err; },
      false,
    );
    if (streamError) {
      await cleanup();
      onError(streamError);
      return;
    }

    const action = parseControlAction(aiResponse);
    const rawToolAttempt = aiResponse.match(/"tool"\s*:\s*"([^"]+)"/)?.[1] ?? '';
    if (rawToolAttempt && isRawMouseActionName(rawToolAttempt)) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `Rejected raw mouse tool "${rawToolAttempt}". Use visual.clickIntent or visual.typeIntent only.` });
      emitStep({
        id: nowStepId('raw-blocked'),
        type: 'error',
        tool: rawToolAttempt,
        error: 'raw_mouse_tool_not_available',
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    if (!action) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: 'Invalid action JSON. Return exactly one allowed action object with an "action" field.' });
      emitStep({
        id: nowStepId('parse-error'),
        type: 'error',
        error: 'invalid_control_action',
        output: aiResponse.slice(0, 500),
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const stepId = nowStepId('action');
    emitStep({
      id: stepId,
      type: 'tool_call',
      tool: action.action,
      input: JSON.stringify(action, null, 2),
      timestamp: new Date().toISOString(),
    });

    if (action.action === 'ask_user') {
      onStatus('waiting_user');
      await guardPause();
      await restoreMainWindow();
      const answer = await onAskUser(action.question);
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `User answered: ${answer}` });
      continue;
    }

    if (action.action === 'task.complete') {
      await finalDeduct(userId, totalCostUsd);
      emitStep({
        id: nowStepId('complete'),
        type: 'complete',
        output: action.summary,
        timestamp: new Date().toISOString(),
      });
      await cleanup();
      onStatus('complete');
      onComplete(action.summary);
      return;
    }

    if (actionTouchesScreen(action)) await ensureScreenPrepared();
    const inputAction = actionInjectsInput(action);
    if (inputAction) await guardSetBlock(true);
    let result;
    try {
      result = await executeControlAction(action, {
        userId,
        task,
        addCost: (usd) => { totalCostUsd += usd; },
      });
    } finally {
      if (inputAction) await guardSetBlock(false);
    }

    if (result.success) lastSuccessfulAction = action.action;

    emitStep({
      id: `${stepId}-result`,
      type: result.success ? 'tool_result' : 'error',
      tool: action.action,
      output: result.output,
      error: result.error,
      screenshotBase64: result.screenshot?.base64,
      timestamp: new Date().toISOString(),
      details: { ...result.details, lastSuccessfulAction },
    });
    await updateOverlay({ active: true, status: 'executing', task, steps });

    messages.push({ role: 'assistant', content: aiResponse });
    messages.push({
      role: 'user',
      content: result.success
        ? `Action result: ${result.output}\nComplete only when this result proves the requested outcome.`
        : `Action error: ${result.error ?? result.output}\nSwitch to a different layer on the escalation ladder rather than repeating. Raw mouse tools are unavailable.`,
    });
  }

  await finalDeduct(userId, totalCostUsd);
  await cleanup();
  onError(`Reached maximum iterations (${MAX_ITERATIONS})`);
}
