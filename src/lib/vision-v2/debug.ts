// Vision Mouse V2 — observability artifacts.
//
// Every V2 step can dump its inputs/outputs to a per-run debug folder so a failed
// click is fully reconstructable: ScreenState, provider stats, the ActionPlan,
// the ActionResult, the verification, the coordinate-conversion log, and the
// before/after screenshots. Best-effort — never throws into the agent loop.
//
// The model itself always receives the CLEAN screenshot + structured element
// list (these artifacts are written to disk, not fed back to the planner) unless
// Set-of-Mark label mode is explicitly active.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenState, ActionPlan, ActionResult } from './types';

const ENABLED_KEY = 'larund_click_vision_v2_debug';

/** Debug artifact dumping is opt-in (separate from the V2 feature flag). */
export function isDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function newRunId(): string {
  return `run-${Date.now()}`;
}

async function writeFile(path: string, content: string): Promise<void> {
  try {
    await invoke('file_write', { path, content });
  } catch {
    /* best-effort */
  }
}

export interface StepArtifacts {
  screenStateBefore?: ScreenState;
  screenStateAfter?: ScreenState;
  providerStats?: unknown;
  plan?: ActionPlan;
  rawPlan?: string;
  result?: ActionResult & { log?: string[]; chosenElementId?: string };
  coordinateLog?: string[];
  verification?: unknown;
  /** Precision V3 refine record (what/where/why/refined?/verified?). */
  refine?: unknown;
  branch?: string;
}

/** Persist one step's artifacts under ~/.larund-click/vision-v2-debug/<runId>/. */
export async function saveArtifacts(runId: string, step: number, a: StepArtifacts): Promise<void> {
  if (!isDebugEnabled()) return;
  const dir = `~/.larund-click/vision-v2-debug/${runId}`;
  const prefix = `${dir}/step-${String(step).padStart(3, '0')}`;

  // Strip heavy base64 out of the JSON; write images separately.
  const stripShot = (s?: ScreenState) =>
    s ? { ...s, screenshot_base64: s.screenshot_base64 ? '<omitted>' : undefined } : undefined;

  const summary = {
    branch: a.branch,
    plan: a.plan,
    rawPlan: a.rawPlan,
    result: a.result,
    verification: a.verification,
    refine: a.refine,
    providerStats: a.providerStats,
    coordinateLog: a.coordinateLog,
    screenStateBefore: stripShot(a.screenStateBefore),
    screenStateAfter: stripShot(a.screenStateAfter),
  };
  await writeFile(`${prefix}.json`, JSON.stringify(summary, null, 2));

  if (a.screenStateBefore?.screenshot_base64) {
    await writeFile(`${prefix}-before.jpg.b64`, a.screenStateBefore.screenshot_base64);
  }
  if (a.screenStateAfter?.screenshot_base64) {
    await writeFile(`${prefix}-after.jpg.b64`, a.screenStateAfter.screenshot_base64);
  }
}
