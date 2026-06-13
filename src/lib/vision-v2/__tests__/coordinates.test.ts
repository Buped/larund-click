import { describe, it, expect } from 'vitest';
import {
  normalizedToPixel, pixelToNormalized, screenshotToScreenPoint,
  screenToScreenshotPoint, windowToScreenPoint, screenToWindowPoint,
  clampPointToScreen, validateScreenPoint, boundsToBBox,
} from '../coordinates';

describe('normalized ↔ pixel', () => {
  it('maps 0 → 0 and 999 → width-1', () => {
    expect(normalizedToPixel(0, 0, 1920, 1080)).toEqual([0, 0]);
    expect(normalizedToPixel(999, 999, 1920, 1080)).toEqual([1919, 1079]);
  });

  it('maps the midpoint to roughly the center', () => {
    const [x, y] = normalizedToPixel(500, 500, 1000, 1000);
    expect(x).toBeCloseTo(500, -1);
    expect(y).toBeCloseTo(500, -1);
  });

  it('round-trips within 1px', () => {
    const [nx, ny] = pixelToNormalized(960, 540, 1920, 1080);
    const [px, py] = normalizedToPixel(nx, ny, 1920, 1080);
    expect(Math.abs(px - 960)).toBeLessThanOrEqual(2);
    expect(Math.abs(py - 540)).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-range normalized input', () => {
    expect(normalizedToPixel(-100, 5000, 1000, 1000)).toEqual([0, 999]);
  });
});

describe('screenshot ↔ screen scaling', () => {
  const shot = { screenshot_width: 960, screenshot_height: 540 };
  const screen = { screen_width: 1920, screen_height: 1080, dpi_scale: 2 };

  it('scales a half-size screenshot up to the screen', () => {
    expect(screenshotToScreenPoint([100, 100], shot, screen)).toEqual([200, 200]);
  });
  it('scales screen down to the screenshot', () => {
    expect(screenToScreenshotPoint([200, 200], shot, screen)).toEqual([100, 100]);
  });
  it('is the identity when sizes match', () => {
    const same = { screen_width: 960, screen_height: 540, dpi_scale: 1 };
    expect(screenshotToScreenPoint([42, 84], shot, same)).toEqual([42, 84]);
  });
});

describe('window ↔ screen', () => {
  const rect = { x: 100, y: 50, width: 800, height: 600 };
  it('adds the window offset', () => {
    expect(windowToScreenPoint([10, 10], rect)).toEqual([110, 60]);
  });
  it('subtracts the window offset', () => {
    expect(screenToWindowPoint([110, 60], rect)).toEqual([10, 10]);
  });
});

describe('clamp + validation + bounds conversion', () => {
  it('clamps to the screen', () => {
    expect(clampPointToScreen([5000, -3], 1920, 1080)).toEqual([1919, 0]);
  });
  it('rejects off-screen points', () => {
    const screen = { screen_width: 1920, screen_height: 1080, dpi_scale: 1 };
    expect(validateScreenPoint([100, 100], screen)).toBeNull();
    expect(validateScreenPoint([-1, 100], screen)).toMatch(/negative/);
    expect(validateScreenPoint([5000, 100], screen)).toMatch(/off-screen/);
  });
  it('converts UIA bounds to a bbox', () => {
    expect(boundsToBBox({ x: 10, y: 20, width: 100, height: 40 })).toEqual([10, 20, 110, 60]);
  });
});
