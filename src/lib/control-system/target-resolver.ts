import type { Point, ScreenObservation, TargetCandidate, VisualClickIntent } from './types';
import { bboxArea, bboxCenter, bboxHeight, bboxWidth, pointInsideBBox, validateBBox } from './geometry';
import { normalizeText, observationText } from './observe';

function tokenOverlap(hay: string, needle: string): number {
  const hayTokens = new Set(normalizeText(hay).split(' ').filter(Boolean));
  const needleTokens = normalizeText(needle).split(' ').filter(Boolean);
  if (!needleTokens.length || !hayTokens.size) return 0;
  return needleTokens.filter((token) => hayTokens.has(token)).length / needleTokens.length;
}

function isLargeContainer(candidate: TargetCandidate, obs: ScreenObservation): boolean {
  if (candidate.reasons.includes('large_container')) return true;
  if (/pane|window|document|group|list|container/i.test(candidate.role) && !candidate.text.trim()) return true;
  return bboxWidth(candidate.bbox) > obs.capture.coordinateSpace.width * 0.72
    || bboxHeight(candidate.bbox) > obs.capture.coordinateSpace.height * 0.55;
}

export function selectClickPoint(candidate: TargetCandidate): Point {
  const explicit = candidate.metadata?.clickPoint;
  if (Array.isArray(explicit) && explicit.length === 2 && explicit.every(Number.isFinite) && pointInsideBBox(explicit as Point, candidate.bbox)) {
    return [Math.round(explicit[0]), Math.round(explicit[1])];
  }
  if (/card|tile|game|item/i.test(candidate.role)) {
    return [
      Math.round(candidate.bbox[0] + bboxWidth(candidate.bbox) * 0.5),
      Math.round(candidate.bbox[1] + bboxHeight(candidate.bbox) * 0.45),
    ];
  }
  return bboxCenter(candidate.bbox);
}

export function rankLocalCandidates(obs: ScreenObservation, intent: VisualClickIntent): TargetCandidate[] {
  const target = normalizeText(intent.target);
  const fullIntent = normalizeText(`${intent.target} ${intent.expected} ${intent.task ?? ''}`);
  const screenText = observationText(obs);
  const appBoost = intent.app && screenText.includes(normalizeText(intent.app)) ? 0.05 : 0;
  return obs.candidates
    .map((candidate): TargetCandidate | null => {
      if (!candidate.clickable) return null;
      if (validateBBox(candidate.bbox, obs.capture.coordinateSpace)) return null;
      if (isLargeContainer(candidate, obs)) return null;
      const hay = normalizeText(`${candidate.label} ${candidate.text} ${candidate.role}`);
      const exact = target && hay.includes(target) ? 0.42 : 0;
      const overlap = tokenOverlap(hay, fullIntent);
      const sourceBoost = candidate.source === 'uia' ? 0.16 : candidate.source === 'heuristic' ? 0.18 : 0.10;
      const roleBoost = /button|link|card|tile|input|edit/i.test(candidate.role) ? 0.14 : 0;
      const whitespacePenalty = normalizeText(`${candidate.label} ${candidate.text}`).length < 2 && bboxArea(candidate.bbox) > 8_000 ? 0.4 : 0;
      const rankScore = candidate.confidence + exact + overlap * 0.34 + sourceBoost + roleBoost + appBoost - whitespacePenalty;
      if (rankScore < 0.65) return null;
      return {
        ...candidate,
        confidence: Math.min(1, Math.max(candidate.confidence, rankScore > 0.9 ? 0.82 : candidate.confidence)),
        reasons: [
          ...candidate.reasons,
          exact ? 'exact_text_match' : '',
          overlap ? `token_overlap=${overlap.toFixed(2)}` : '',
          `rank=${rankScore.toFixed(2)}`,
        ].filter(Boolean),
        metadata: { ...candidate.metadata, rankScore },
      };
    })
    .filter((candidate): candidate is TargetCandidate => !!candidate)
    .sort((a, b) => Number(b.metadata?.rankScore ?? 0) - Number(a.metadata?.rankScore ?? 0));
}
