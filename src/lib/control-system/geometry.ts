import type { BBox, CoordinateSpace, Point, ScreenRegion } from './types';

export function bboxWidth(bbox: BBox): number {
  return Math.max(0, bbox[2] - bbox[0]);
}

export function bboxHeight(bbox: BBox): number {
  return Math.max(0, bbox[3] - bbox[1]);
}

export function bboxArea(bbox: BBox): number {
  return bboxWidth(bbox) * bboxHeight(bbox);
}

export function bboxCenter(bbox: BBox): Point {
  return [Math.round(bbox[0] + bboxWidth(bbox) / 2), Math.round(bbox[1] + bboxHeight(bbox) / 2)];
}

export function regionToBBox(region: ScreenRegion): BBox {
  return [region.x, region.y, region.x + region.width, region.y + region.height];
}

export function bboxToRegion(bbox: BBox): ScreenRegion {
  return { x: bbox[0], y: bbox[1], width: bboxWidth(bbox), height: bboxHeight(bbox) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function validatePoint(point: Point, space: Pick<CoordinateSpace, 'origin' | 'width' | 'height'>): string | null {
  if (!point.every(Number.isFinite)) return 'point_non_finite';
  const maxX = space.origin[0] + space.width;
  const maxY = space.origin[1] + space.height;
  if (point[0] < space.origin[0] || point[1] < space.origin[1] || point[0] >= maxX || point[1] >= maxY) return 'point_outside_space';
  return null;
}

export function validateBBox(bbox: BBox, space: Pick<CoordinateSpace, 'origin' | 'width' | 'height'>): string | null {
  if (!bbox.every(Number.isFinite)) return 'bbox_non_finite';
  if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return 'bbox_non_positive';
  const maxX = space.origin[0] + space.width;
  const maxY = space.origin[1] + space.height;
  if (bbox[0] < space.origin[0] || bbox[1] < space.origin[1] || bbox[2] > maxX || bbox[3] > maxY) return 'bbox_outside_space';
  return null;
}

export function pointInsideBBox(point: Point, bbox: BBox, inset = 0): boolean {
  return point[0] >= bbox[0] + inset && point[0] <= bbox[2] - inset
    && point[1] >= bbox[1] + inset && point[1] <= bbox[3] - inset;
}

export function paddedRegion(bbox: BBox, screen: { width: number; height: number }, pad: number): ScreenRegion {
  const x = clamp(Math.floor(bbox[0] - pad), 0, screen.width - 1);
  const y = clamp(Math.floor(bbox[1] - pad), 0, screen.height - 1);
  const right = clamp(Math.ceil(bbox[2] + pad), x + 1, screen.width);
  const bottom = clamp(Math.ceil(bbox[3] + pad), y + 1, screen.height);
  return { x, y, width: right - x, height: bottom - y };
}
