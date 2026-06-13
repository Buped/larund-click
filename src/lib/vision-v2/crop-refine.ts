// Vision Mouse V2 — crop + zoom re-grounding.
//
// When a structured click can't be made precisely (low confidence, tiny/ambiguous
// target, failed verification, or we'd otherwise need a raw click), refine the
// target by zooming into its region and re-locating a safe point. Reuses the
// existing Rust desktop_visual_locate / desktop_zoom_target_region — no new CV.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenElement, Point } from './types';
import { clamp } from './geometry';

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
