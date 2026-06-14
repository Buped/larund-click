import { invoke } from '@tauri-apps/api/core';
import type { ScreenObservation, TargetCandidate, VerifiedMouseTarget, VisualClickIntent } from './types';
import { pointInsideBBox, validateBBox, validatePoint } from './geometry';
import { selectClickPoint } from './target-resolver';

export function makeVerifiedMouseTarget(
  before: ScreenObservation,
  candidate: TargetCandidate,
  intent: VisualClickIntent,
  opts: { coarseCell?: string; fineCell?: string } = {},
): VerifiedMouseTarget {
  if (!before.capture.base64) throw new Error('no_screenshot_no_click');
  const bboxError = validateBBox(candidate.bbox, before.capture.coordinateSpace);
  if (bboxError) throw new Error(`invalid_target_bbox:${bboxError}`);
  const clickPoint = selectClickPoint(candidate);
  const pointError = validatePoint(clickPoint, before.capture.coordinateSpace);
  if (pointError) throw new Error(`invalid_click_point:${pointError}`);
  if (!pointInsideBBox(clickPoint, candidate.bbox)) throw new Error('invalid_click_point:outside_bbox');
  if (candidate.confidence < 0.75) throw new Error('low_confidence_target');
  return {
    label: candidate.label,
    bbox: candidate.bbox,
    clickPoint,
    confidence: candidate.confidence,
    source: candidate.source,
    before: before.capture,
    expectation: intent.expected,
    reasons: candidate.reasons,
    coarseCell: opts.coarseCell,
    fineCell: opts.fineCell,
  };
}

export async function executeVerifiedClick(target: VerifiedMouseTarget): Promise<void> {
  await invoke('mouse_click_verified', {
    x: Math.round(target.clickPoint[0]),
    y: Math.round(target.clickPoint[1]),
    targetLabel: target.label,
    bbox: target.bbox.map(Math.round),
    confidence: target.confidence,
    source: target.source,
  });
}
