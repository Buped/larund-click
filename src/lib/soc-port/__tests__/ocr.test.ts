import { describe, expect, it } from 'vitest';
import { bboxCenterPercent, getTextElement, parseSocOcr } from '../ocr';

describe('SOC port OCR click', () => {
  it('prefers substring OCR item and uses original OCR bbox', () => {
    const ocr = parseSocOcr(JSON.stringify([
      { text: 'ALMA', bbox: { x: 10, y: 10, width: 40, height: 10 }, confidence: 0.6 },
      { text: 'BANAN', bbox: { x: 10, y: 40, width: 70, height: 10 }, confidence: 0.6 },
    ]));
    const item = getTextElement(ocr, 'BANAN');
    expect(item?.text).toBe('BANAN');
    expect(item?.bbox).toEqual([10, 40, 80, 50]);
    expect(bboxCenterPercent(item!, { width: 100, height: 100 })).toEqual({
      center: { x: 45, y: 45 },
      percent: { x: 0.45, y: 0.45 },
    });
  });

  it('falls back to neighboring split OCR words', () => {
    const ocr = parseSocOcr(JSON.stringify([
      { text: 'BAN', bbox: { x: 10, y: 40, width: 30, height: 10 }, confidence: 0.6 },
      { text: 'AN', bbox: { x: 42, y: 40, width: 20, height: 10 }, confidence: 0.6 },
    ]));
    const item = getTextElement(ocr, 'BAN AN');
    expect(item?.source).toBe('group');
    expect(item?.bbox).toEqual([10, 40, 62, 50]);
  });
});
