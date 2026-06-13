// Vision Mouse V2 — verification layer.
//
// After an action, the orchestrator builds a fresh ScreenState and asks: did the
// expected change happen? Deterministic checks (text/window/url/focus) are
// preferred; visual_change is a coarse screenshot diff; llm_check is a documented
// soft-pass fallback for non-deterministic outcomes; none always passes.
//
// Pure over (before, after) ScreenStates so it is fully unit-tested.

import type { ScreenState, VerificationSpec, VerificationResult } from './types';
import { normalizeText } from './text-match';

/** Does any element text or the window title contain `value` (normalized)? */
export function textPresent(state: ScreenState, value: string): boolean {
  const needle = normalizeText(value);
  if (!needle) return false;
  if (normalizeText(state.active_window_title).includes(needle)) return true;
  return state.elements.some((e) => normalizeText(e.name || e.text).includes(needle));
}

/** Coarse 0..1 difference between two base64 screenshots (sampled). */
export function screenshotDiffRatio(a?: string, b?: string): number {
  if (!a || !b) return a === b ? 0 : 1;
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  const step = Math.max(1, Math.floor(n / 2000)); // sample ≤2000 points
  let diff = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) { if (a[i] !== b[i]) diff++; count++; }
  const lenPenalty = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  return Math.min(1, diff / Math.max(1, count) + lenPenalty * 0.5);
}

const VISUAL_CHANGE_THRESHOLD = 0.05;

export function verifyV2(
  spec: VerificationSpec | undefined,
  before: ScreenState,
  after: ScreenState,
): VerificationResult {
  if (!spec || spec.type === 'none') return { verified: true, type: 'none' };

  switch (spec.type) {
    case 'text_appears': {
      const v = spec.value ?? '';
      const ok = textPresent(after, v) && (!textPresent(before, v) || true);
      return { verified: ok, type: spec.type, detail: ok ? `"${v}" present` : `"${v}" not found` };
    }
    case 'text_disappears': {
      const v = spec.value ?? '';
      const ok = !textPresent(after, v);
      return { verified: ok, type: spec.type, detail: ok ? `"${v}" gone` : `"${v}" still present` };
    }
    case 'window_changed': {
      const ok = normalizeText(before.active_window_title) !== normalizeText(after.active_window_title);
      return { verified: ok, type: spec.type, detail: `${before.active_window_title} → ${after.active_window_title}` };
    }
    case 'panel_opened': {
      // A panel opening usually adds elements and/or the expected text appears.
      const grew = after.elements.length > before.elements.length;
      const textOk = spec.value ? textPresent(after, spec.value) : false;
      const ok = textOk || grew;
      return { verified: ok, type: spec.type, detail: textOk ? 'expected text appeared' : grew ? 'element count grew' : 'no panel change' };
    }
    case 'focus_changed': {
      const f = (s: ScreenState) => s.elements.find((e) => e.metadata?.focused)?.id ?? '';
      const ok = f(before) !== f(after);
      return { verified: ok, type: spec.type, detail: `focus ${f(before)} → ${f(after)}` };
    }
    case 'url_changed': {
      const ok = (before.browser_url ?? '') !== (after.browser_url ?? '');
      return { verified: ok, type: spec.type, detail: `${before.browser_url ?? ''} → ${after.browser_url ?? ''}` };
    }
    case 'visual_change': {
      const ratio = screenshotDiffRatio(before.screenshot_base64, after.screenshot_base64);
      const ok = ratio >= VISUAL_CHANGE_THRESHOLD;
      return { verified: ok, type: spec.type, detail: `diff ratio ${ratio.toFixed(3)}` };
    }
    case 'llm_check':
      // Non-deterministic — soft pass (documented limitation). The orchestrator
      // still records it so a follow-up LLM judge can be wired here later.
      return { verified: true, type: spec.type, detail: 'llm_check soft-pass (not deterministically verified)' };

    default:
      return { verified: true, type: 'none' };
  }
}
