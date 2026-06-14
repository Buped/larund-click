import { describe, expect, it } from 'vitest';
import { findOcrText, parseOcrJson } from '../ocr';
import { buildLabelMap, findLabel } from '../labels';
import { bboxCenter } from '../coordinates';

describe('SOC OCR text click and labels', () => {
  it('parses Windows OCR and fuzzy matches text', () => {
    const boxes = parseOcrJson(JSON.stringify([
      { text: 'Ground', bbox: { x: 100, y: 200, width: 70, height: 20 }, confidence: 0.6 },
      { text: 'Ground War', bbox: { x: 200, y: 220, width: 110, height: 30 }, confidence: 0.7 },
    ]));
    const match = findOcrText(boxes, 'ground war');
    expect(match?.bbox).toEqual([200, 220, 310, 250]);
    expect(bboxCenter(match!.bbox)).toEqual({ x: 255, y: 235 });
  });

  it('fuzzy matches text split across neighboring OCR words', () => {
    const boxes = parseOcrJson(JSON.stringify([
      { text: 'Ground', bbox: { x: 14, y: 85, width: 47, height: 10 }, confidence: 0.6 },
      { text: 'war', bbox: { x: 70, y: 85, width: 24, height: 10 }, confidence: 0.6 },
      { text: 'Continue', bbox: { x: 14, y: 103, width: 64, height: 10 }, confidence: 0.6 },
    ]));
    const match = findOcrText(boxes, 'Ground War');
    expect(match?.text).toBe('Ground war');
    expect(match?.bbox).toEqual([14, 85, 94, 95]);
  });

  it('builds label map and resolves click labels', () => {
    const labels = buildLabelMap([
      { id: 'ocr-1', text: 'Ground War', bbox: [200, 220, 310, 250], confidence: 0.7 },
    ], { width: 800, height: 600 });
    expect(labels[0].label).toBe('~1');
    expect(findLabel(labels, '~1')?.text).toBe('Ground War');
  });
});
