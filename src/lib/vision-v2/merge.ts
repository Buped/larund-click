// Vision Mouse V2 — multi-source element merge / dedup.
//
// Providers describe the same screen from different angles (DOM, UIA, OCR, ...).
// This collapses them into one ranked ScreenElement list:
//   • filters invalid / zero-size / off-screen pixel elements
//   • dedups by IoU (pixel sources) and by text+role (any source, incl. DOM)
//   • applies source priority (dom > uia > ocr > omniparser > vision > grid)
//   • when sources agree, keeps the best one, records all in metadata.sources[]
//     and boosts its confidence
//   • pushes clickable elements forward
//
// Pure (no I/O) so it is fully unit-tested.

import type { ScreenElement, ElementSource } from './types';
import { SOURCE_PRIORITY } from './types';
import { iou, isUsableBBox, bboxArea } from './geometry';
import { normalizeText } from './text-match';

const IOU_DUP_THRESHOLD = 0.6;

function priorityIndex(source: ElementSource): number {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i < 0 ? SOURCE_PRIORITY.length : i;
}

/** Coarse role category so "Hyperlink"/"a" or "Edit"/"input" compare equal. */
function roleClass(role: string): string {
  const r = (role ?? '').toLowerCase();
  if (/button|splitbutton/.test(r)) return 'button';
  if (/hyperlink|link|^a$/.test(r)) return 'link';
  if (/edit|input|textbox|searchbox|combobox|textarea/.test(r)) return 'edit';
  if (/menuitem/.test(r)) return 'menuitem';
  if (/tab/.test(r)) return 'tab';
  if (/check|radio/.test(r)) return 'toggle';
  if (/text|label|document/.test(r)) return 'text';
  return r || 'other';
}

/** A DOM element has no pixels (bbox all zero). */
function isPixelless(e: ScreenElement): boolean {
  return e.bbox[0] === 0 && e.bbox[1] === 0 && e.bbox[2] === 0 && e.bbox[3] === 0;
}

function sameText(a: ScreenElement, b: ScreenElement): boolean {
  const ta = normalizeText(a.name || a.text);
  const tb = normalizeText(b.name || b.text);
  return ta.length > 0 && ta === tb;
}

/** Do two elements refer to the same on-screen thing? */
function isDuplicate(a: ScreenElement, b: ScreenElement): boolean {
  const roleMatch = roleClass(a.role) === roleClass(b.role);
  // Pixel overlap (only meaningful when both have real bboxes).
  if (!isPixelless(a) && !isPixelless(b)) {
    if (iou(a.bbox, b.bbox) >= IOU_DUP_THRESHOLD) return true;
  }
  // Text + role match works across sources (incl. DOM vs UIA).
  if (roleMatch && sameText(a, b)) return true;
  return false;
}

export interface MergeOptions {
  screenWidth?: number;
  screenHeight?: number;
}

export interface MergeStats {
  bySource: Record<string, number>;
  beforeMerge: number;
  afterMerge: number;
  merged: number;
}

export interface MergeResult {
  elements: ScreenElement[];
  stats: MergeStats;
}

/** Flatten provider lists, filter, dedup, and rank. */
export function mergeElements(lists: ScreenElement[][], opts: MergeOptions = {}): MergeResult {
  const flat = lists.flat();
  const bySource: Record<string, number> = {};
  for (const e of flat) bySource[e.source] = (bySource[e.source] ?? 0) + 1;

  // 1. Filter invalid pixel elements.
  const filtered = flat.filter((e) => {
    if (!e.visible) return false;
    if (isPixelless(e)) return true; // DOM-style, no pixels → keep
    if (!isUsableBBox(e.bbox)) return false;
    if (opts.screenWidth && opts.screenHeight) {
      const [x1, y1, x2, y2] = e.bbox;
      if (x2 <= 0 || y2 <= 0 || x1 >= opts.screenWidth || y1 >= opts.screenHeight) return false;
    }
    return true;
  });

  // 2. Order so the preferred "winner" is seen first: source priority, then
  //    confidence, then smaller area (more specific).
  const ordered = [...filtered].sort((a, b) => {
    const pa = priorityIndex(a.source);
    const pb = priorityIndex(b.source);
    if (pa !== pb) return pa - pb;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return bboxArea(a.bbox) - bboxArea(b.bbox);
  });

  // 3. Dedup against kept winners.
  const kept: ScreenElement[] = [];
  for (const cand of ordered) {
    const winner = kept.find((k) => isDuplicate(k, cand));
    if (winner) {
      const sources = (winner.metadata?.sources as ElementSource[] | undefined) ?? [winner.source];
      if (!sources.includes(cand.source)) sources.push(cand.source);
      winner.metadata = { ...winner.metadata, sources };
      winner.confidence = Math.min(0.99, Math.max(winner.confidence, cand.confidence) + 0.05);
    } else {
      cand.metadata = { ...cand.metadata, sources: [cand.source] };
      kept.push(cand);
    }
  }

  // 4. Final ranking: clickable first, then priority, then confidence.
  kept.sort((a, b) => {
    if (a.clickable !== b.clickable) return a.clickable ? -1 : 1;
    const pa = priorityIndex(a.source);
    const pb = priorityIndex(b.source);
    if (pa !== pb) return pa - pb;
    return b.confidence - a.confidence;
  });

  return {
    elements: kept,
    stats: { bySource, beforeMerge: flat.length, afterMerge: kept.length, merged: flat.length - kept.length },
  };
}
