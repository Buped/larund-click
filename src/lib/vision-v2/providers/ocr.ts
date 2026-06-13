// Vision Mouse V2 — OCR provider (adapter).
//
// OCR helps only with canvas / custom-drawn UIs that expose no UIA tree and are
// not in a browser. UIA (native apps) and DOM (web) already give us text for the
// benchmark tasks, so this pass ships a WIRED adapter that returns [] — the
// pipeline runs it, counts it, and is ready to use real results the moment a
// backend is plugged in.
//
// Drop-in path for a real provider (no new crate needed): Windows.Media.Ocr is
// available offline via WinRT and can be driven from PowerShell exactly like
// desktop_read. Implement a Rust command `ocr_read(region?)` returning
// [{ text, bbox:{x,y,width,height}, confidence }], then map it here just like
// uiaTargetsToElements does.

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

/**
 * Read OCR elements. No backend wired this pass → returns []. When a real
 * `ocr_read` command is added, call it here and pass through ocrBoxesToElements.
 */
export async function readOcrElements(): Promise<ScreenElement[]> {
  return [];
}
