// Vision Mouse V2 — crop + zoom re-grounding.
//
// When a structured click can't be made precisely (low confidence, tiny/ambiguous
// target, failed verification, or we'd otherwise need a raw click), refine the
// target by zooming into its region and re-locating a safe point. Reuses the
// existing Rust desktop_visual_locate / desktop_zoom_target_region — no new CV.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenElement, Point, ScreenState } from './types';
import { clamp, bboxArea, isUsableBBox } from './geometry';
import { readRegionElements } from './screen-state';
import { specificityScore, isLargeContainer } from './precision';
import { validateScreenPoint } from './coordinates';
import { bestTextMatch } from './text-match';

/**
 * Transform a point measured INSIDE a zoomed crop back to absolute screen
 * coordinates. `region` is the crop's screen-space origin/size; `zoom` is how
 * many crop pixels equal one screen pixel. Pure + unit-tested.
 */
export function cropToScreenPoint(
  local: Point, region: { x: number; y: number; width: number; height: number }, zoom: number,
): Point {
  const z = Math.max(1, zoom);
  return [
    Math.round(region.x + clamp(local[0] / z, 0, region.width)),
    Math.round(region.y + clamp(local[1] / z, 0, region.height)),
  ];
}

export interface RefineResult {
  point?: Point;
  confidence: number;
  method: string;
  log: string[];
}

interface VisualCandidate { x: number; y: number; confidence: number; method: string; }
interface VisualLocateResult { candidate_points: VisualCandidate[]; confidence: number; reason: string; }

/**
 * Refine a UIA element (preferred) or an explicit region into a better screen
 * click point. desktop_visual_locate already returns ABSOLUTE-screen candidate
 * points, so we just pick the most confident one.
 */
export async function cropRefine(
  el: ScreenElement | undefined,
  region?: { x: number; y: number; width: number; height: number },
): Promise<RefineResult> {
  const log: string[] = [];
  const args: Record<string, unknown> = { id: null, snapshotToken: null, region: region ?? null };
  if (el && el.source === 'uia' && el.metadata?.uiaId) {
    args.id = String(el.metadata.uiaId);
    args.snapshotToken = String(el.metadata.snapshot_token ?? '');
  }
  if (!args.id && !region && el) {
    // Build a padded region around the element's bbox as the crop target.
    const [x1, y1, x2, y2] = el.bbox;
    args.region = { x: x1 - 8, y: y1 - 8, width: (x2 - x1) + 16, height: (y2 - y1) + 16 };
  }

  try {
    const raw = await invoke<string>('desktop_visual_locate', args);
    const res = JSON.parse(raw) as VisualLocateResult;
    const best = [...(res.candidate_points ?? [])].sort((a, b) => b.confidence - a.confidence)[0];
    if (best) {
      log.push(`visual_locate → ${best.method} @${best.x},${best.y} (${best.confidence.toFixed(2)})`);
      return { point: [best.x, best.y], confidence: best.confidence, method: `refine_${best.method}`, log };
    }
    log.push('visual_locate returned no candidates');
  } catch (e) {
    log.push(`visual_locate failed: ${String(e)}`);
  }

  // Last fallback: element center (if any).
  if (el) {
    log.push('refine fallback: element center');
    return { point: el.center, confidence: el.confidence * 0.8, method: 'refine_center', log };
  }
  return { confidence: 0, method: 'refine_none', log };
}

export interface PrecisionRefineResult {
  point?: Point;
  confidence: number;
  /** 'region_child' (found a smaller specific child), or a refine_* fallback. */
  method: string;
  /** Id of the smaller child element chosen by the region read, if any. */
  chosenChildId?: string;
  chosenChildBBox?: [number, number, number, number];
  /** Number of elements the region precision read returned. */
  candidates: number;
  log: string[];
}

/** Padded screen region around an element's bbox, for region reads / OCR. */
export function paddedRegion(
  el: ScreenElement, state: Pick<ScreenState, 'screen_width' | 'screen_height'>, pad = 16,
): { x: number; y: number; width: number; height: number } {
  const [x1, y1, x2, y2] = el.bbox;
  const x = Math.max(0, x1 - pad);
  const y = Math.max(0, y1 - pad);
  const right = Math.min(state.screen_width || x2 + pad, x2 + pad);
  const bottom = Math.min(state.screen_height || y2 + pad, y2 + pad);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/**
 * Precision V3 refine. This is the fix for the "clicks 20–30px off in Roblox"
 * miss: a large container's own geometry (center / safe-inset) is always wrong, so
 * instead of re-picking a point inside the SAME bbox we re-read the UIA+OCR tree
 * restricted to the target's region and pick a SMALLER, more specific child.
 * Falls back to the visual_locate candidate points, then the element center.
 */
export async function precisionRefine(
  el: ScreenElement | undefined,
  state: ScreenState,
  opts: { query?: string } = {},
): Promise<PrecisionRefineResult> {
  const log: string[] = [];
  if (!el) {
    const r = await cropRefine(undefined);
    return { ...r, candidates: 0 };
  }

  const region = paddedRegion(el, state);
  let children: ScreenElement[] = [];
  try {
    children = await readRegionElements(region);
    log.push(`region read @[${region.x},${region.y},${region.width}x${region.height}] → ${children.length} elements`);
  } catch (e) {
    log.push(`region read failed: ${String(e)}`);
  }

  const parentArea = bboxArea(el.bbox) || 1;
  // Keep clickable children that are meaningfully SMALLER than the parent and not
  // themselves large containers — these are the precise targets we want.
  let candidates = children.filter((c) =>
    c.id !== el.id &&
    c.clickable &&
    isUsableBBox(c.bbox) &&
    bboxArea(c.bbox) < parentArea * 0.85 &&
    !isLargeContainer(c) &&
    !validateScreenPoint(c.clickable_point, state),
  );

  if (opts.query && candidates.length) {
    const m = bestTextMatch(opts.query, candidates, (c) => c.name || c.text, 0.45);
    if (m) {
      log.push(`region child matched "${opts.query}" → ${m.item.id}`);
      return {
        point: m.item.clickable_point, confidence: Math.max(m.item.confidence, 0.7),
        method: 'region_child', chosenChildId: m.item.id, chosenChildBBox: m.item.bbox,
        candidates: children.length, log,
      };
    }
  }

  if (candidates.length) {
    candidates = candidates.sort((a, b) => specificityScore(b) - specificityScore(a));
    const best = candidates[0];
    log.push(`region child by specificity → ${best.id} (${best.role} "${best.name}")`);
    return {
      point: best.clickable_point, confidence: Math.max(best.confidence, 0.65),
      method: 'region_child', chosenChildId: best.id, chosenChildBBox: best.bbox,
      candidates: children.length, log,
    };
  }

  // No better child found → fall back to visual_locate candidate points.
  log.push('no smaller child found; falling back to visual_locate');
  const fallback = await cropRefine(el, region);
  return { ...fallback, log: [...log, ...fallback.log], candidates: children.length };
}

/** Capture a zoomed image of a region/target for the planner to re-examine. */
export async function zoomTargetRegion(
  el: ScreenElement | undefined,
  region: { x: number; y: number; width: number; height: number } | undefined,
  zoom = 2,
): Promise<{ base64: string; width: number; height: number } | null> {
  try {
    const args: Record<string, unknown> = { id: null, snapshotToken: null, region: region ?? null, zoom };
    if (el && el.source === 'uia' && el.metadata?.uiaId) {
      args.id = String(el.metadata.uiaId);
      args.snapshotToken = String(el.metadata.snapshot_token ?? '');
    }
    return await invoke<{ base64: string; width: number; height: number }>('desktop_zoom_target_region', args);
  } catch {
    return null;
  }
}
