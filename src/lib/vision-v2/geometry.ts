// Vision Mouse V2 — pure geometry helpers.
//
// No I/O, no Tauri — every function here is deterministic and unit-tested.
// Used by the coordinate service, the element merger (IoU dedup), and the
// safe-click-point logic in the executor.

import type { BBox, Point } from './types';

export function bboxWidth(b: BBox): number {
  return Math.max(0, b[2] - b[0]);
}

export function bboxHeight(b: BBox): number {
  return Math.max(0, b[3] - b[1]);
}

export function bboxArea(b: BBox): number {
  return bboxWidth(b) * bboxHeight(b);
}

/** Geometric center of a bbox, rounded to whole pixels. */
export function bboxCenter(b: BBox): Point {
  return [
    Math.round(b[0] + bboxWidth(b) / 2),
    Math.round(b[1] + bboxHeight(b) / 2),
  ];
}

/** True if the bbox is on-screen and has a non-trivial size. */
export function isUsableBBox(b: BBox, minSide = 2): boolean {
  return bboxWidth(b) >= minSide && bboxHeight(b) >= minSide;
}

/** Intersection-over-union of two bboxes. 0 when disjoint, 1 when identical. */
export function iou(a: BBox, b: BBox): number {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Clamp a point so it stays strictly inside the given bounds. */
export function clampPointToBounds(p: Point, bounds: BBox): Point {
  return [
    Math.min(Math.max(p[0], bounds[0]), bounds[2]),
    Math.min(Math.max(p[1], bounds[1]), bounds[3]),
  ];
}

export type ClickStrategy =
  | 'center'
  | 'left_glyph'   // checkbox / radio — aim at the box, not the label
  | 'safe_inset';  // generic control — center, but inset from the edges

/**
 * Pick a robust click point inside a bbox. Mirrors the Rust `current_safe_point`
 * / `resolve_visual_anchor` behaviour so the legacy and V2 paths agree, but kept
 * pure here so it can be unit-tested and reused by the executor.
 */
export function safeClickPoint(b: BBox, strategy: ClickStrategy = 'safe_inset'): Point {
  const w = bboxWidth(b);
  const h = bboxHeight(b);
  const [cx, cy] = bboxCenter(b);

  if (strategy === 'left_glyph') {
    // Aim a quarter-width in from the left edge (the glyph), clamped sanely.
    const dx = clamp(Math.round(w / 4), 6, 18);
    return [b[0] + dx, cy];
  }

  if (strategy === 'safe_inset') {
    const insetX = clamp(Math.round(w / 6), 4, 18);
    const insetY = clamp(Math.round(h / 6), 4, 18);
    const minX = b[0] + insetX;
    const maxX = b[2] - insetX;
    const minY = b[1] + insetY;
    const maxY = b[3] - insetY;
    return [
      clamp(cx, minX, Math.max(maxX, minX)),
      clamp(cy, minY, Math.max(maxY, minY)),
    ];
  }

  return [cx, cy];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
