// Vision Mouse V2 — OmniParser / Set-of-Mark provider (adapter/stub).
//
// OmniParser is an optional visual parser that labels interactable regions of a
// screenshot. It is NOT a hard dependency: this adapter returns [] unless a
// backend is configured, so we never pull large model weights uncontrolled.
//
// To enable later: add a Rust/sidecar command that runs OmniParser on the
// screenshot and returns [{ label, bbox, interactable, description, confidence }],
// then map it here (source 'omniparser') the same way ocrBoxesToElements does.

import type { ScreenElement } from '../types';
import { boundsToBBox } from '../coordinates';
import { bboxCenter, safeClickPoint, isUsableBBox } from '../geometry';

export interface OmniLabel {
  label: string;
  bbox: { x: number; y: number; width: number; height: number };
  interactable?: boolean;
  description?: string;
  confidence?: number;
}

export function omniLabelsToElements(labels: OmniLabel[]): ScreenElement[] {
  const out: ScreenElement[] = [];
  labels.forEach((l, i) => {
    const bbox = boundsToBBox(l.bbox);
    if (!isUsableBBox(bbox)) return;
    out.push({
      id: `omni_${i}`,
      source: 'omniparser',
      role: 'Label',
      name: l.label,
      text: l.label,
      description: l.description,
      bbox,
      center: bboxCenter(bbox),
      clickable_point: safeClickPoint(bbox, 'safe_inset'),
      clickable: l.interactable !== false,
      confidence: typeof l.confidence === 'number' ? l.confidence : 0.5,
      visible: true,
      metadata: { label: l.label, som: true },
    });
  });
  return out;
}

/** No backend configured this pass → []. */
export async function readOmniElements(): Promise<ScreenElement[]> {
  return [];
}
