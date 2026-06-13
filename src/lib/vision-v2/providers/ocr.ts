// Vision Mouse V2 — OCR provider (adapter).
//
// OCR helps with canvas / custom-drawn UIs that expose no UIA tree and are not in
// a browser (e.g. the Roblox launcher's game cards). UIA (native apps) and DOM
// (web) already give us text for most tasks, so OCR is used selectively: the
// `ocr_read` Rust command (Windows.Media.Ocr, offline WinRT, driven from
// PowerShell like desktop_read) is called with a REGION during crop/refine so we
// don't pay full-screen OCR every frame.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenElement } from '../types';
import { boundsToBBox } from '../coordinates';
import { bboxCenter, safeClickPoint, isUsableBBox } from '../geometry';

export interface OcrBox {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

/** Normalize raw OCR boxes (when a backend exists) into ScreenElements. */
export function ocrBoxesToElements(boxes: OcrBox[]): ScreenElement[] {
  const out: ScreenElement[] = [];
  boxes.forEach((b, i) => {
    const bbox = boundsToBBox(b.bbox);
    if (!isUsableBBox(bbox)) return;
    out.push({
      id: `ocr_${i}`,
      source: 'ocr',
      role: 'Text',
      name: b.text,
      text: b.text,
      bbox,
      center: bboxCenter(bbox),
      clickable_point: safeClickPoint(bbox, 'safe_inset'),
      clickable: true,
      confidence: typeof b.confidence === 'number' ? b.confidence : 0.5,
      visible: true,
      metadata: { ocr: true },
    });
  });
  return out;
}

export interface OcrRegion { x: number; y: number; width: number; height: number; }

/**
 * Read OCR text boxes via the `ocr_read` Rust command (Windows.Media.Ocr). Returns
 * absolute-screen ScreenElements. Best-effort: any failure (no backend, no
 * Windows, region off-screen) yields []. A full-screen call (no region) is allowed
 * but discouraged — prefer a region during crop/refine.
 */
export async function readOcrElements(region?: OcrRegion | null): Promise<ScreenElement[]> {
  // Full-screen OCR every frame is too slow; OCR is a targeted refine tool. Only
  // run it when a region is supplied (crop/refine, region precision read).
  if (!region) return [];
  try {
    const raw = await invoke<string>('ocr_read', { region });
    const boxes = JSON.parse(raw) as OcrBox[];
    return ocrBoxesToElements(Array.isArray(boxes) ? boxes : []);
  } catch {
    return [];
  }
}
