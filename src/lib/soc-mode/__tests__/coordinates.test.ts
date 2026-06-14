import { describe, expect, it } from 'vitest';
import { bboxCenter, percentToPixel } from '../coordinates';

describe('SOC coordinates', () => {
  it('converts SOC percent coordinates to screenshot pixels', () => {
    expect(percentToPixel('0.5', 0.25, { width: 1920, height: 1080 })).toEqual({ x: 960, y: 270 });
  });

  it('calculates bbox centers', () => {
    expect(bboxCenter([10, 20, 30, 60])).toEqual({ x: 20, y: 40 });
  });
});
