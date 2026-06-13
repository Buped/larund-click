// Vision Mouse V2 — Precision Click V3.
//
// The V2 grounding picks the right *region* but often clicks 20–30px off the real
// target in complex / custom UIs (Roblox launcher, game cards, canvas apps). The
// root cause is twofold:
//   1. A large UIA container (Pane/Document/List/Custom, hundreds of px wide) is
//      chosen and clicked at its safe-inset *center*, which lands in dead space or
//      a neighbouring control.
//   2. An OS mouse click "succeeds" even when it hits the wrong pixel, so the miss
//      is never corrected.
//
// This module is the pure, unit-tested decision layer for V3:
//   • requiresPreClickRefine() — decide BEFORE clicking whether a target is too
//     coarse to trust and must be re-grounded (crop/refine) first.
//   • specificityScore()       — rank a small, specific child above a big container.
//   • precision metadata keys   — the typed shape the UIA provider attaches.
//
// No I/O, no Tauri here so it can be exercised in isolation.

import type { ScreenElement, ScreenState } from './types';
import { bboxArea, bboxWidth, bboxHeight } from './geometry';

export type PrecisionLevel = 'high' | 'medium' | 'low';

/**
 * Precision-relevant fields the UIA provider (and, later, OmniParser/OCR region
 * reads) stash on `ScreenElement.metadata`. Read via `precisionMeta()` so callers
 * never reach into the untyped bag directly.
 */
export interface PrecisionMeta {
  click_strategy?: string;
  precision_level?: PrecisionLevel | string;
  target_confidence?: number;
  children_count?: number;
  is_large_container?: boolean;
  can_invoke?: boolean;
  /** Set by the provider when the element cannot be clicked accurately as-is. */
  requires_refine?: boolean;
}

/** Roles that are containers, not leaf targets — clicking their center is unsafe. */
const CONTAINER_ROLES = /\b(pane|document|group|list|datagrid|custom|tree|table|grid)\b/i;

/** Roles that are specific, leaf-level, reliably clickable. */
const SPECIFIC_ROLES = /\b(button|listitem|dataitem|menuitem|tabitem|hyperlink|link|checkbox|radio|edit|splitbutton)\b/i;

/** App/window titles whose UI is canvas/custom-drawn → UIA tree is coarse. */
const CUSTOM_UI_APPS = /\b(roblox|epic\s*games|steam|battle\.?net|riot|launcher|unity|unreal|electron|canvas|game)\b/i;

// Geometry thresholds (mirror the Rust infer_precision_metadata heuristics so the
// TS and Rust sides agree on what "large" means).
export const LARGE_W = 280;
export const LARGE_H = 140;
export const LARGE_AREA = 55_000;
export const MANY_CHILDREN = 8;
export const LOW_CONFIDENCE = 0.75;

/** Typed view of an element's precision metadata. */
export function precisionMeta(el: ScreenElement): PrecisionMeta {
  return (el.metadata ?? {}) as PrecisionMeta;
}

/** True when the active app is known to expose only a coarse/custom UIA tree. */
export function isCustomUiApp(state: Pick<ScreenState, 'active_app_name' | 'active_window_title'>): boolean {
  return CUSTOM_UI_APPS.test(`${state.active_app_name ?? ''} ${state.active_window_title ?? ''}`);
}

/** Is this element a big container we should never click in the center of? */
export function isLargeContainer(el: ScreenElement): boolean {
  const m = precisionMeta(el);
  if (m.is_large_container === true) return true;
  const w = bboxWidth(el.bbox);
  const h = bboxHeight(el.bbox);
  if (w > LARGE_W || h > LARGE_H) return true;
  if (bboxArea(el.bbox) > LARGE_AREA) return true;
  if ((m.children_count ?? 0) >= MANY_CHILDREN) return true;
  if (el.source === 'uia' && CONTAINER_ROLES.test(el.role)) return true;
  return false;
}

export interface PreClickRefineDecision {
  refine: boolean;
  reasons: string[];
}

/**
 * Decide whether `el` must be re-grounded (crop/refine) BEFORE we click it.
 * Returns the boolean the orchestrator gates on plus the reasons (for debug
 * artifacts / logs). Detailed variant; `requiresPreClickRefine` is the boolean.
 */
export function evaluatePreClickRefine(el: ScreenElement, state: ScreenState): PreClickRefineDecision {
  const reasons: string[] = [];
  const m = precisionMeta(el);

  if (m.requires_refine === true) reasons.push('metadata.requires_refine');
  if (m.click_strategy === 'visual_refine') reasons.push('strategy=visual_refine');
  if (m.precision_level === 'low') reasons.push('precision=low');
  if (m.is_large_container === true) reasons.push('is_large_container');
  if ((m.children_count ?? 0) >= MANY_CHILDREN) reasons.push(`children=${m.children_count}`);

  const w = bboxWidth(el.bbox);
  const h = bboxHeight(el.bbox);
  if (w > LARGE_W || h > LARGE_H) reasons.push(`bbox ${w}x${h} > ${LARGE_W}x${LARGE_H}`);
  if (bboxArea(el.bbox) > LARGE_AREA) reasons.push(`area ${bboxArea(el.bbox)} > ${LARGE_AREA}`);

  if (el.source === 'uia' && CONTAINER_ROLES.test(el.role)) reasons.push(`container role ${el.role}`);

  const conf = typeof m.target_confidence === 'number' ? m.target_confidence : el.confidence;
  if (conf < LOW_CONFIDENCE) reasons.push(`confidence ${conf.toFixed(2)} < ${LOW_CONFIDENCE}`);

  // Custom/game UI: even a "specific" leaf can be a mislabeled canvas region, so a
  // large-ish target in such an app is refined.
  if (isCustomUiApp(state) && (w > 120 || h > 80)) reasons.push('custom_ui_app + large-ish bbox');

  // A truly small, high-confidence, specific, invokable leaf is exempt even if one
  // soft signal fired (e.g. a tiny low-confidence icon stays trustworthy).
  const tinySpecific =
    w <= 64 && h <= 64 &&
    SPECIFIC_ROLES.test(el.role) &&
    (m.can_invoke === true) &&
    conf >= LOW_CONFIDENCE;
  if (tinySpecific) return { refine: false, reasons: ['tiny specific invokable leaf — no refine'] };

  return { refine: reasons.length > 0, reasons };
}

/** Boolean form used by the executor/orchestrator gates. */
export function requiresPreClickRefine(el: ScreenElement, state: ScreenState): boolean {
  return evaluatePreClickRefine(el, state).refine;
}

/**
 * Specificity score in [0,1]-ish range; higher means a smaller, more specific,
 * more reliably-clickable element. Used by the merger so a precise child (game
 * card / list item / button) outranks the big Pane/List it lives inside.
 */
export function specificityScore(el: ScreenElement): number {
  const m = precisionMeta(el);
  let score = 0.5;

  // Reward: specific leaf roles.
  if (SPECIFIC_ROLES.test(el.role)) score += 0.25;
  // Penalize: container roles.
  if (CONTAINER_ROLES.test(el.role)) score -= 0.3;

  // Reward: small bbox (more specific). Penalize large area.
  const area = bboxArea(el.bbox);
  if (area > 0) {
    if (area < 18_000) score += 0.2;
    else if (area > LARGE_AREA) score -= 0.25;
    else if (area > 120_000) score -= 0.35;
  }
  if (bboxWidth(el.bbox) > LARGE_W || bboxHeight(el.bbox) > LARGE_H) score -= 0.15;

  // Large container / many children → strong penalty.
  if (m.is_large_container === true) score -= 0.25;
  if ((m.children_count ?? 0) >= MANY_CHILDREN) score -= 0.15;

  // Reward: invokable, named, confident.
  if (m.can_invoke === true) score += 0.15;
  if ((el.name || el.text || '').trim().length > 0) score += 0.1;
  const conf = typeof m.target_confidence === 'number' ? m.target_confidence : el.confidence;
  score += (conf - 0.5) * 0.3;

  // Precision level signal.
  if (m.precision_level === 'high') score += 0.1;
  else if (m.precision_level === 'low') score -= 0.15;

  return score;
}
