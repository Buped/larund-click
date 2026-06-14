// Completion guard. The loop routes every `task.complete` through here *before*
// closing the run. If the requested outcome is not verified by the evidence, the
// completion is rejected and the model is told to keep going. This is enforced in
// code, not just in the prompt, so a too-eager model cannot shortcut it.

import type { ActiveTaskState, RecentAction } from '../agent-state/types';
import { verifyCompletion } from './goal-verifier';

export interface GuardResult {
  ok: boolean;
  reason: string;
  nextStepHint: string;
}

export function verifyBeforeComplete(
  state: ActiveTaskState,
  recent: RecentAction[],
): GuardResult {
  // If the user previously corrected a false completion, a prior task.complete is
  // not acceptable as evidence; the verifier already ignores control actions, but
  // we additionally require fresh successful work *after* the last correction.
  if (state.userCorrections.length > 0) {
    const hasFreshWork = recent.some(
      (a) => a.success && !['task.complete', 'ask_user', 'approval.request'].includes(a.action),
    );
    if (!hasFreshWork) {
      return {
        ok: false,
        reason: 'You were corrected; the previous completion was wrong. Redo the work — do not just re-complete.',
        nextStepHint: 'Take the corrective action on the real target, then verify.',
      };
    }
  }

  const v = verifyCompletion(state, recent);
  return { ok: v.ok, reason: v.reason, nextStepHint: v.nextStepHint };
}

/** Message fed back to the model when a completion is rejected. */
export function rejectionMessage(result: GuardResult): string {
  return `Completion rejected: ${result.reason}\nRequired next step: ${result.nextStepHint}\nContinue using structured tools; do not claim success until verified.`;
}
