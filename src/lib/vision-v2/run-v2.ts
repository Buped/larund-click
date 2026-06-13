// Vision Mouse V2 — per-iteration orchestrator.
//
// runVisionV2Turn performs ONE agent step the V2 way:
//   ensureScreenClear → buildScreenState → planV2 → safety gate
//   → executeV2 (with crop/refine before any raw click) → verifyV2
//   → emit steps + save debug artifacts → update planner memory
// and returns a discriminated result the agent loop acts on. Across turns it
// carries lastResult + retryContext so the planner can change strategy after a
// failure instead of repeating it. Any unexpected throw becomes a clean
// `fallback_legacy` so the agent loop never crashes.

import type { AgentStep } from '../agent-loop';
import type { ActionResult, ScreenState, CliObservation } from './types';
import { buildScreenState } from './screen-state';
import { planV2 } from './planner';
import { executeV2 } from './executor';
import { verifyV2 } from './verify';
import { cropRefine } from './crop-refine';
import { classifyRisk } from './safety';
import { saveArtifacts, newRunId, type StepArtifacts } from './debug';
import { invoke } from '@tauri-apps/api/core';

export interface V2Memory {
  runId: string;
  step: number;
  lastResult?: ActionResult;
  /** Output of the most recent cli_command — the CLI half of HybridState. */
  lastCli?: CliObservation;
  retryContext?: string;
  lastTargetKey?: string;
  sameTargetCount: number;
}

export function newV2Memory(): V2Memory {
  return { runId: newRunId(), step: 0, sameTargetCount: 0 };
}

export interface V2TurnContext {
  task: string;
  modelId: string;
  userId: string;
  webHint: boolean;
  autonomyMode: 'full' | 'semi' | 'manual';
  mem: V2Memory;
  addCost: (usd: number) => void;
  emitStep: (step: AgentStep) => void;
  ensureScreenClear: () => Promise<void>;
  restoreForUser: () => Promise<void>;
  guardSetBlock: (on: boolean) => Promise<void>;
  isAborted: () => Promise<boolean>;
  onAskUser: (question: string) => Promise<string>;
}

export type V2TurnResult =
  | { kind: 'continue' }
  | { kind: 'complete'; summary: string }
  | { kind: 'aborted' }
  | { kind: 'fallback_legacy'; reason: string };

const MAX_SAME_TARGET = 2;
const stepId = (s: string) => `v2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${s}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function targetKey(planAction: string, chosen?: string, text?: string): string {
  return `${planAction}:${chosen ?? text ?? ''}`;
}

/** Coarse modality label for logs, derived from the executor's used_method. */
function modalityOf(usedMethod: string): string {
  if (usedMethod === 'cli') return 'cli';
  if (usedMethod === 'browser' || usedMethod === 'dom') return 'browser/dom';
  if (usedMethod.startsWith('uia')) return 'uia';
  if (usedMethod === 'hotkey' || usedMethod === 'keyboard') return 'hotkey/keyboard';
  if (usedMethod.startsWith('mouse')) return 'mouse';
  return usedMethod;
}

function approved(answer: string): boolean {
  const a = answer.toLowerCase();
  return a.includes('yes') || a.includes('ok') || a.includes('proceed') || a.includes('igen');
}

export async function runVisionV2Turn(ctx: V2TurnContext): Promise<V2TurnResult> {
  const { mem } = ctx;
  mem.step += 1;

  // 1. Observe — clear the chat window, then build a ScreenState.
  await ctx.ensureScreenClear();
  if (await ctx.isAborted()) return { kind: 'aborted' };

  const built = await buildScreenState({ webHint: ctx.webHint });
  const before: ScreenState = built.state;

  // HybridState observation log: the planner sees CLI output AND the screen.
  const prevModality = mem.lastResult?.used_method ?? 'none';
  console.log('[V2] observe', {
    step: mem.step, prevAction: mem.lastResult?.action_executed ?? null, prevModality,
    afterCli: !!mem.lastCli, screenshot: !!before.screenshot_base64,
    elements: before.elements.length, window: before.active_window_title,
    sawCli: !!mem.lastCli, sawScreen: true,
  });

  // 2. Plan — given BOTH the previous CLI output and the current ScreenState.
  const planRes = await planV2({
    goal: ctx.task,
    state: before,
    lastResult: mem.lastResult,
    cli: mem.lastCli,
    retryContext: mem.retryContext,
    modelId: ctx.modelId,
    userId: ctx.userId,
    addCost: ctx.addCost,
  });
  if (planRes.kind === 'fallback') {
    ctx.emitStep({
      id: stepId('fallback'), type: 'thinking',
      output: `Vision V2 planner could not produce a valid plan (${planRes.reason}); falling back to legacy.`,
      timestamp: new Date().toISOString(), details: { branch: 'v2', fallback: true },
    });
    return { kind: 'fallback_legacy', reason: planRes.reason };
  }
  const plan = planRes.plan;
  mem.retryContext = undefined;

  // Surface the plan (reason as live thinking + the action as a tool call).
  ctx.emitStep({
    id: stepId('think'), type: 'thinking', output: plan.reason || `Plan: ${plan.action}`,
    timestamp: new Date().toISOString(), details: { branch: 'v2', phase: 'plan', confidence: plan.confidence },
  });
  ctx.emitStep({
    id: stepId('call'), type: 'tool_call', tool: `v2:${plan.action}`,
    input: planRes.raw, timestamp: new Date().toISOString(), details: { branch: 'v2' },
  });

  // 3. Terminal / interactive actions.
  if (plan.action === 'done') {
    return { kind: 'complete', summary: plan.summary || 'Task completed.' };
  }
  if (plan.action === 'ask_user') {
    await ctx.restoreForUser();
    const answer = await ctx.onAskUser(plan.question || 'What should I do?');
    if (await ctx.isAborted()) return { kind: 'aborted' };
    mem.retryContext = `User answered: ${answer}`;
    return { kind: 'continue' };
  }

  // 4. Safety gate + manual-mode confirmation.
  const risk = classifyRisk(plan);
  const isInputAction = ['cli_command', 'browser_open', 'hotkey', 'click_element', 'click_text', 'click_label', 'type_text', 'raw_click'].includes(plan.action);
  if (risk.level === 'high' || (ctx.autonomyMode === 'manual' && isInputAction)) {
    await ctx.restoreForUser();
    const q = risk.level === 'high'
      ? `⚠️ ${risk.reason}\n\nProceed with: ${plan.action} "${plan.target?.text ?? plan.target?.element_id ?? plan.text ?? ''}"?`
      : `Manual mode: run ${plan.action} "${plan.target?.text ?? plan.target?.element_id ?? ''}"?`;
    const answer = await ctx.onAskUser(q);
    if (await ctx.isAborted()) return { kind: 'aborted' };
    if (!approved(answer)) {
      mem.retryContext = `User declined the ${plan.action}. Choose a different, safe next step.`;
      return { kind: 'continue' };
    }
  }

  // Guard against hammering the same target.
  const key = targetKey(plan.action, plan.target?.element_id, plan.target?.text ?? plan.command ?? plan.url);
  mem.sameTargetCount = key === mem.lastTargetKey ? mem.sameTargetCount + 1 : 1;
  mem.lastTargetKey = key;
  if (mem.sameTargetCount > MAX_SAME_TARGET && plan.action === 'raw_click') {
    mem.retryContext = 'You repeated the same raw_click; switch to an element/text/hotkey strategy.';
    ctx.emitStep({
      id: stepId('guard'), type: 'error', tool: `v2:${plan.action}`,
      error: 'stalled_same_raw_click', timestamp: new Date().toISOString(), details: { branch: 'v2' },
    });
    return { kind: 'continue' };
  }

  // 5. Execute (with crop/refine before any raw fallback).
  let result = await executeV2(plan, before, { guardSetBlock: ctx.guardSetBlock });
  const coordinateLog = [...result.log];

  if (!result.success && result.needsRefine) {
    const el = result.chosenElementId
      ? before.elements.find((e) => e.id === result.chosenElementId)
      : undefined;
    const refine = await cropRefine(el);
    coordinateLog.push(...refine.log);
    if (refine.point) {
      try {
        await ctx.guardSetBlock(true);
        await invoke('mouse_click', { x: refine.point[0], y: refine.point[1], button: 'left' });
        coordinateLog.push(`crop/refine click @${refine.point[0]},${refine.point[1]} (${refine.method})`);
        result = { ...result, success: true, used_method: 'mouse_safe_point', error: undefined };
      } catch (e) {
        result = { ...result, error: `refine click failed: ${String(e)}` };
      } finally {
        await ctx.guardSetBlock(false);
      }
    }
  }

  // 6. Verify against a fresh ScreenState.
  await sleep(plan.expect?.timeout_ms ? Math.min(plan.expect.timeout_ms, 2500) : 500);
  const afterBuilt = await buildScreenState({ webHint: ctx.webHint });
  const after = afterBuilt.state;
  const verification = verifyV2(plan.expect, before, after);

  const finalResult: ActionResult = {
    success: result.success,
    action_executed: plan.action,
    used_method: result.used_method,
    before_screenshot: before.screenshot_base64,
    after_screenshot: after.screenshot_base64,
    error: result.error,
    verification,
  };

  // Capture the CLI observation so the NEXT planner step sees it (HybridState).
  const prevWasCli = mem.lastResult?.action_executed === 'cli_command';
  if (result.cli) mem.lastCli = result.cli;

  const modality = modalityOf(result.used_method);
  const rawClickUsed = result.used_method === 'mouse_raw';
  // Explicit modality-transition log (CLI→visual etc.).
  console.log('[V2] action', {
    step: mem.step, action: plan.action, modality, used_method: result.used_method,
    success: result.success, verification: verification.type, verified: verification.verified,
    raw_click_used: rawClickUsed,
    transition: prevWasCli && plan.action !== 'cli_command' ? 'cli→visual'
      : (!prevWasCli && plan.action === 'cli_command' ? 'visual→cli' : 'same'),
  });
  if (plan.action === 'cli_command' && /chrome|msedge|firefox|code|explorer|notepad|start /i.test(plan.command ?? '')) {
    console.log('[V2] CLI likely opened/changed a GUI → next step will observe the screen');
  }

  // 7. Emit result + persist artifacts.
  ctx.emitStep({
    id: stepId('result'), type: result.success ? 'tool_result' : 'error',
    tool: `v2:${plan.action}`,
    output: JSON.stringify({
      success: result.success, used_method: result.used_method, modality,
      chosen: result.chosenElementId, verification,
      cli: result.cli ? { exitCode: result.cli.exitCode } : undefined,
    }),
    error: result.success ? undefined : result.error,
    timestamp: new Date().toISOString(),
    screenshotBase64: after.screenshot_base64,
    details: {
      branch: 'v2', modality, used_method: result.used_method,
      verification, chosenElementId: result.chosenElementId,
      raw_click_used: rawClickUsed,
      screenshot_taken: !!before.screenshot_base64,
      screen_state_count: before.elements.length,
      planner_saw_cli: prevWasCli || !!mem.lastCli,
      planner_saw_screen: true,
      cli_exit: result.cli?.exitCode,
      coordinate_log: coordinateLog,
    },
  });

  const artifacts: StepArtifacts = {
    branch: 'v2', plan, rawPlan: planRes.raw, result: { ...finalResult, log: coordinateLog, chosenElementId: result.chosenElementId },
    verification, providerStats: built.stats, coordinateLog,
    screenStateBefore: before, screenStateAfter: after,
  };
  await saveArtifacts(mem.runId, mem.step, artifacts);

  // 8. Memory for the next turn.
  mem.lastResult = finalResult;
  if (!result.success || (plan.expect?.required && !verification.verified)) {
    const what = result.success
      ? `ran but verification (${verification.type}) FAILED`
      : `FAILED: ${result.error}`;
    mem.retryContext =
      `Previous ${plan.action} ${what}. ` +
      'Do NOT repeat the same action/target. Try a different element, text, hotkey, or strategy.';
  }

  return { kind: 'continue' };
}
