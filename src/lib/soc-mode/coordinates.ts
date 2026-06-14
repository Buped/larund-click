import type { SocScreenshot } from './types';

export type BBox = [number, number, number, number];

export function parsePercentCoordinate(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid_percent_coordinate:${value}`);
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error(`percent_coordinate_out_of_range:${parsed}`);
  }
  return parsed;
}

export function percentToPixel(
  x: string | number,
  y: string | number,
  screenshot: Pick<SocScreenshot, 'width' | 'height'>,
): { x: number; y: number } {
  const px = Math.round(parsePercentCoordinate(x) * screenshot.width);
  const py = Math.round(parsePercentCoordinate(y) * screenshot.height);
  return {
    x: Math.max(0, Math.min(screenshot.width - 1, px)),
    y: Math.max(0, Math.min(screenshot.height - 1, py)),
  };
}

export function bboxCenter(bbox: BBox): { x: number; y: number } {
  return {
    x: Math.round((bbox[0] + bbox[2]) / 2),
    y: Math.round((bbox[1] + bbox[3]) / 2),
  };
}

export function bboxSize(bbox: BBox): { width: number; height: number } {
  return { width: Math.max(0, bbox[2] - bbox[0]), height: Math.max(0, bbox[3] - bbox[1]) };
}

export function clampBBox(bbox: BBox, width: number, height: number): BBox {
  return [
    Math.max(0, Math.min(width - 1, Math.round(bbox[0]))),
    Math.max(0, Math.min(height - 1, Math.round(bbox[1]))),
    Math.max(0, Math.min(width - 1, Math.round(bbox[2]))),
    Math.max(0, Math.min(height - 1, Math.round(bbox[3]))),
  ];
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
