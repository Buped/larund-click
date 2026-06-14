import type { ClickVerification, ScreenObservation, VisualClickIntent } from './types';
import { normalizeText, observationText } from './observe';

export function screenshotDiffRatio(before?: string, after?: string): number {
  if (!before || !after) return 0;
  const min = Math.min(before.length, after.length);
  if (!min) return 0;
  const every = Math.max(1, Math.floor(min / 2_000));
  let sampled = 0;
  let changed = Math.abs(before.length - after.length);
  for (let i = 0; i < min; i += every) {
    sampled++;
    if (before[i] !== after[i]) changed++;
  }
  return Math.min(1, changed / Math.max(1, sampled + Math.abs(before.length - after.length)));
}

function expectedMatched(after: ScreenObservation, expected: string): boolean {
  const expectedTokens = normalizeText(expected).split(' ').filter((token) => token.length >= 3);
  const screenTokens = new Set(observationText(after).split(' ').filter(Boolean));
  if (!expectedTokens.length) return false;
  const hits = expectedTokens.filter((token) => screenTokens.has(token)).length;
  return hits >= Math.min(2, expectedTokens.length) || hits / expectedTokens.length >= 0.5;
}

function robloxMatched(after: ScreenObservation, intent: VisualClickIntent): string | null {
  const isRoblox = normalizeText(`${intent.app ?? ''} ${intent.task ?? ''} ${intent.expected}`).includes('roblox');
  if (!isRoblox) return null;
  const text = observationText(after);
  if (text.includes('ground war') && /\b(play|join|joining|loading|leave|servers|server|experience|start)\b/.test(text)) {
    return 'roblox_detail_or_play_state';
  }
  if (/\b(loading|joining|starting|teleporting|leave)\b/.test(text)) return 'roblox_loading_or_session_state';
  return null;
}

export function verifyVisualAction(before: ScreenObservation, after: ScreenObservation, intent: VisualClickIntent): ClickVerification {
  const diffRatio = screenshotDiffRatio(before.capture.base64, after.capture.base64);
  const roblox = robloxMatched(after, intent);
  const stateMatched = expectedMatched(after, intent.expected) || !!roblox;
  if (stateMatched) {
    return { verified: true, reason: roblox ?? 'expected_state_visible', diffRatio, stateMatched: true };
  }
  if (diffRatio >= 0.02) {
    return { verified: true, reason: 'visual_change_detected', diffRatio, stateMatched: false };
  }
  return { verified: false, reason: 'no_verified_visual_or_state_change', diffRatio, stateMatched: false };
}
