// Vision Mouse V2 — ScreenState builder.
//
// observe → capture → run providers → merge → ScreenState. This is the single
// entry point the planner/executor use to "see" the screen. Every provider is
// best-effort: a thrown provider contributes no elements rather than failing the
// whole build, so perception degrades gracefully (UIA-only, DOM-only, etc.).

import { invoke } from '@tauri-apps/api/core';
import type { ScreenState, ScreenElement } from './types';
import { getScreenMetrics } from './coordinates';
import { readUiaElements, type UiaReadResult } from './providers/uia';
import { readDomElements, isBrowserOpen } from './providers/dom';
import { readOcrElements } from './providers/ocr';
import { readOmniElements } from './providers/omniparser';
import { mergeElements, type MergeStats } from './merge';

export interface BuildScreenStateOptions {
  /** Task looks web-oriented → include the DOM provider even before Chrome is up. */
  webHint?: boolean;
  /** Capture a fresh (grid-free) screenshot for the planner. Default true. */
  captureScreenshot?: boolean;
  monitorId?: number;
}

export interface BuildScreenStateResult {
  state: ScreenState;
  stats: MergeStats;
  /** Per-stage notes (which providers ran, errors swallowed) for debug logs. */
  log: string[];
}

interface ShotResult { base64: string; width: number; height: number; monitor_id: number; }

export async function buildScreenState(
  opts: BuildScreenStateOptions = {},
): Promise<BuildScreenStateResult> {
  const log: string[] = [];

  // 1. Clean screenshot (grid OFF — the planner gets a pristine image + the
  //    structured element list; the legacy grid stays for the legacy path).
  let shot: ShotResult | null = null;
  if (opts.captureScreenshot !== false) {
    try {
      shot = await invoke<ShotResult>('take_screenshot', {
        monitorId: opts.monitorId ?? null, grid: false, region: null,
      });
    } catch (e) {
      log.push(`screenshot failed: ${String(e)}`);
    }
  }

  // 2. Screen metrics.
  let screenW = shot?.width ?? 0;
  let screenH = shot?.height ?? 0;
  let dpi = 1;
  try {
    const m = await getScreenMetrics(opts.monitorId);
    screenW = m.screen_width || screenW;
    screenH = m.screen_height || screenH;
    dpi = m.dpi_scale;
  } catch (e) {
    log.push(`metrics failed: ${String(e)}`);
  }

  // 3. UIA provider (foreground window) — always attempted.
  let uiaWindow: UiaReadResult['window'] | null = null;
  let uiaElements: ScreenElement[] = [];
  try {
    const uia = await readUiaElements('semantic');
    uiaElements = uia.elements;
    uiaWindow = uia.window;
    log.push(`uia: ${uiaElements.length} elements (${uiaWindow?.title ?? ''})`);
  } catch (e) {
    log.push(`uia failed: ${String(e)}`);
  }

  // 4. DOM provider — only when a browser context is active (browser_read would
  //    otherwise auto-launch Chrome).
  let domElements: ScreenElement[] = [];
  let domUrl = '';
  const wantDom = opts.webHint || (await isBrowserOpen().catch(() => false));
  if (wantDom) {
    try {
      const dom = await readDomElements();
      domElements = dom.elements;
      domUrl = dom.url;
      log.push(`dom: ${domElements.length} elements (${domUrl})`);
    } catch (e) {
      log.push(`dom failed: ${String(e)}`);
    }
  } else {
    log.push('dom: skipped (no browser context)');
  }

  // 5. OCR + OmniParser adapters (return [] until a backend is wired).
  const ocrElements = await readOcrElements().catch(() => []);
  const omniElements = await readOmniElements().catch(() => []);
  if (ocrElements.length) log.push(`ocr: ${ocrElements.length} elements`);
  if (omniElements.length) log.push(`omniparser: ${omniElements.length} elements`);

  // 6. Merge.
  const { elements, stats } = mergeElements(
    [domElements, uiaElements, ocrElements, omniElements],
    { screenWidth: screenW, screenHeight: screenH },
  );
  log.push(`merge: ${stats.beforeMerge} → ${stats.afterMerge} (${stats.merged} merged)`);

  const state: ScreenState = {
    screenshot_base64: shot?.base64,
    screenshot_width: shot?.width ?? screenW,
    screenshot_height: shot?.height ?? screenH,
    screen_width: screenW,
    screen_height: screenH,
    dpi_scale: dpi,
    active_window_title: uiaWindow?.title ?? '',
    active_app_name: uiaWindow?.process_name ?? '',
    active_window_rect: uiaWindow
      ? { x: uiaWindow.bounds.x, y: uiaWindow.bounds.y, width: uiaWindow.bounds.width, height: uiaWindow.bounds.height }
      : undefined,
    browser_url: domUrl || undefined,
    elements,
    timestamp: new Date().toISOString(),
  };

  return { state, stats, log };
}

/** Compact, token-cheap element list for the planner prompt. */
export function summarizeElements(elements: ScreenElement[], limit = 60): string {
  return elements.slice(0, limit).map((e) => {
    const name = (e.name || e.text || '').replace(/\s+/g, ' ').slice(0, 50);
    const where = e.source === 'dom' ? 'web' : `${e.center[0]},${e.center[1]}`;
    return `${e.id} [${e.source}/${e.role}] "${name}"${e.clickable ? '' : ' (non-clickable)'} @${where}`;
  }).join('\n');
}
