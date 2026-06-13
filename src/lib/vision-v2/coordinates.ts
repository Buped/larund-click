// Vision Mouse V2 — Coordinate Calibration Layer.
//
// THE single source of truth for every coordinate conversion. No other module
// (and especially none of the Rust grid/anchor code) should reinvent these.
//
// Spaces:
//   • screen      — absolute OS pixels, top-left (0,0). What enigo/Win32 click.
//   • screenshot  — pixels of the captured (possibly scaled) image.
//   • normalized  — 0..999 grid, resolution-independent (model-friendly).
//   • window      — relative to the active window's top-left.
//
// The pure converters are exported on their own so they can be unit-tested
// without Tauri; the metric getters wrap existing Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { BBox, Point, ScreenMetrics, ScreenshotMetrics, WindowRect } from './types';
import { clamp } from './geometry';

const NORM_MAX = 999;

// ─── Pure converters (unit-tested) ─────────────────────────────────────────────

/** normalized 0..999 → pixel within a (width × height) space. */
export function normalizedToPixel(x: number, y: number, width: number, height: number): Point {
  return [
    Math.round((clamp(x, 0, NORM_MAX) / NORM_MAX) * Math.max(0, width - 1)),
    Math.round((clamp(y, 0, NORM_MAX) / NORM_MAX) * Math.max(0, height - 1)),
  ];
}

/** pixel within a (width × height) space → normalized 0..999. */
export function pixelToNormalized(x: number, y: number, width: number, height: number): Point {
  const w = Math.max(1, width - 1);
  const h = Math.max(1, height - 1);
  return [
    Math.round(clamp(x / w, 0, 1) * NORM_MAX),
    Math.round(clamp(y / h, 0, 1) * NORM_MAX),
  ];
}

/**
 * A screenshot may be scaled relative to the real screen (e.g. zoom crops, or a
 * capture at a different resolution). These map a point between the two spaces
 * given both dimensions. When sizes match, this is the identity.
 */
export function screenshotToScreenPoint(
  p: Point, shot: ScreenshotMetrics, screen: ScreenMetrics,
): Point {
  const sx = screen.screen_width / Math.max(1, shot.screenshot_width);
  const sy = screen.screen_height / Math.max(1, shot.screenshot_height);
  return [Math.round(p[0] * sx), Math.round(p[1] * sy)];
}

export function screenToScreenshotPoint(
  p: Point, shot: ScreenshotMetrics, screen: ScreenMetrics,
): Point {
  const sx = Math.max(1, shot.screenshot_width) / Math.max(1, screen.screen_width);
  const sy = Math.max(1, shot.screenshot_height) / Math.max(1, screen.screen_height);
  return [Math.round(p[0] * sx), Math.round(p[1] * sy)];
}

export function screenToWindowPoint(p: Point, rect: WindowRect): Point {
  return [p[0] - rect.x, p[1] - rect.y];
}

export function windowToScreenPoint(p: Point, rect: WindowRect): Point {
  return [p[0] + rect.x, p[1] + rect.y];
}

/** Keep a point inside [0,0,width,height] of the given space. */
export function clampPointToScreen(p: Point, width: number, height: number): Point {
  return [clamp(p[0], 0, Math.max(0, width - 1)), clamp(p[1], 0, Math.max(0, height - 1))];
}

/**
 * Validate that an action's target point is a real on-screen pixel. Returns a
 * reason string when invalid (so the caller can refuse to click off-screen),
 * or null when the point is fine.
 */
export function validateScreenPoint(
  p: Point, screen: ScreenMetrics,
): string | null {
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'non-finite coordinate';
  if (p[0] < 0 || p[1] < 0) return 'negative coordinate';
  if (p[0] >= screen.screen_width || p[1] >= screen.screen_height) return 'coordinate off-screen';
  return null;
}

// ─── Metric getters (wrap existing Tauri commands) ─────────────────────────────

export async function getScreenMetrics(monitorId?: number): Promise<ScreenMetrics> {
  const [w, h] = await invoke<[number, number]>('get_screen_size', {
    monitorId: monitorId ?? null,
  });
  return { screen_width: w, screen_height: h, dpi_scale: 1 };
}

/** Capture metrics inferred from a screenshot result. */
export function getScreenshotMetrics(shot: { width: number; height: number }): ScreenshotMetrics {
  return { screenshot_width: shot.width, screenshot_height: shot.height };
}

/**
 * Active window rect, read from the current UIA snapshot's window bounds. Best
 * effort — returns null when no desktop snapshot is available.
 */
export async function getActiveWindowRect(): Promise<WindowRect | null> {
  try {
    const raw = await invoke<string>('desktop_read', { mode: 'semantic', region: null });
    const parsed = JSON.parse(raw) as { window?: { bounds?: WindowRect } };
    return parsed.window?.bounds ?? null;
  } catch {
    return null;
  }
}

/** Convert a UIA-style {x,y,width,height} bounds object to a V2 BBox tuple. */
export function boundsToBBox(b: { x: number; y: number; width: number; height: number }): BBox {
  return [b.x, b.y, b.x + b.width, b.y + b.height];
}
