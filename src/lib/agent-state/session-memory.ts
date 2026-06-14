// Per-session memory of the active task. Consecutive agent runs in the same chat
// session share one ActiveTaskState so a correction ("no, it's still empty")
// continues the previous task rather than spawning a new, isolated one.
//
// This is an in-process store (the agent runs in the desktop app process). It is
// intentionally simple; durable persistence can later back this with the DB.

import { detectCorrection } from './correction-detector';
import { preflight } from '../control-system/preflight';
import { applyCorrection, createTaskState } from './task-state';
import type { ActiveTaskState } from './types';

const SESSIONS = new Map<string, ActiveTaskState>();

export function getActiveTask(sessionId: string): ActiveTaskState | undefined {
  return SESSIONS.get(sessionId);
}

export function setActiveTask(sessionId: string, state: ActiveTaskState): void {
  SESSIONS.set(sessionId, state);
}

export function clearActiveTask(sessionId: string): void {
  SESSIONS.delete(sessionId);
}

export interface ResolvedTask {
  state: ActiveTaskState;
  isCorrection: boolean;
  signals: string[];
}

/**
 * Resolve the task for a new user message in a session:
 *  - If there is a live prior task and the message reads as a correction /
 *    continuation, fold it into that task (no reset).
 *  - Otherwise classify it fresh and start a new active task.
 */
export function resolveActiveTask(sessionId: string, message: string): ResolvedTask {
  const prior = SESSIONS.get(sessionId);
  const correction = detectCorrection(message);

  if (prior && prior.status !== 'complete' && correction.isCorrection) {
    applyCorrection(prior, message, correction.interpretation, correction.signals);
    SESSIONS.set(sessionId, prior);
    return { state: prior, isCorrection: true, signals: correction.signals };
  }

  // A correction with no live task, or a genuinely new request: start fresh.
  const pf = preflight(message);
  const state = createTaskState(message, pf);
  SESSIONS.set(sessionId, state);
  return { state, isCorrection: correction.isCorrection && Boolean(prior), signals: correction.signals };
}
