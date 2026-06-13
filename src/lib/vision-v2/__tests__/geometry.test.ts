import { describe, it, expect } from 'vitest';
import {
  bboxCenter, bboxArea, iou, clampPointToBounds, safeClickPoint, isUsableBBox,
} from '../geometry';
import type { BBox } from '../types';

describe('bbox geometry', () => {
  it('computes center', () => {
    expect(bboxCenter([0, 0, 100, 50])).toEqual([50, 25]);
    expect(bboxCenter([10, 20, 30, 60])).toEqual([20, 40]);
  });

  it('computes area', () => {
    expect(bboxArea([0, 0, 10, 10])).toBe(100);
    expect(bboxArea([0, 0, 0, 10])).toBe(0);
  });

  it('flags unusable (zero/tiny) bboxes', () => {
    expect(isUsableBBox([0, 0, 100, 40])).toBe(true);
    expect(isUsableBBox([0, 0, 1, 1])).toBe(false);
  });
});

describe('IoU merge metric', () => {
  it('is 1 for identical boxes', () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
  });
  it('is 0 for disjoint boxes', () => {
    expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  });
  it('is 0.25 for a 50% overlap in each axis', () => {
    // a=[0,0,10,10], b=[5,5,15,15] → inter 25, union 175 → 1/7
    expect(iou([0, 0, 10, 10], [5, 5, 15, 15])).toBeCloseTo(25 / 175, 5);
  });
});

describe('clamp + safe click point', () => {
  it('clamps a point into bounds', () => {
    expect(clampPointToBounds([200, -5], [0, 0, 100, 100])).toEqual([100, 0]);
  });

  it('centers a normal control with edge inset', () => {
    const b: BBox = [0, 0, 120, 60];
    const p = safeClickPoint(b, 'safe_inset');
    expect(p).toEqual([60, 30]);
  });

  it('aims at the left glyph for checkboxes', () => {
    const b: BBox = [0, 0, 200, 20];
    const p = safeClickPoint(b, 'left_glyph');
    // quarter-width = 50, clamped to 18 → x = 18, y = center 10
    expect(p).toEqual([18, 10]);
  });

  it('never returns a point outside the bbox', () => {
    const b: BBox = [10, 10, 14, 14]; // tiny
    const [x, y] = safeClickPoint(b, 'safe_inset');
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThanOrEqual(14);
    expect(y).toBeGreaterThanOrEqual(10);
    expect(y).toBeLessThanOrEqual(14);
  });
});
