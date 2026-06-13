// Vision Mouse V2 — UIA provider.
//
// Wraps the existing `desktop_read` command (PowerShell UI Automation, see
// src-tauri/src/commands/desktop.rs) into normalized ScreenElement[]. We do NOT
// re-implement UIA — we adapt its rich output (bounds, role, automation_id,
// invoke/scroll capability, precision metadata, snapshot_token) to the unified
// model so the planner and executor can treat every source the same way.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenElement } from '../types';
import { boundsToBBox } from '../coordinates';
import { bboxCenter, safeClickPoint, isUsableBBox, type ClickStrategy } from '../geometry';

interface UiaBounds { x: number; y: number; width: number; height: number; }
interface UiaTarget {
  id: string;
  name: string;
  role: string;
  automation_id: string | null;
  bounds: UiaBounds;
  enabled: boolean;
  visible: boolean;
  focused: boolean;
  window_title: string;
  can_invoke: boolean;
  can_scroll: boolean;
  is_keyboard_focusable: boolean;
  children_count?: number;
  precision_level?: string;
  target_confidence?: number;
  click_strategy?: string;
  is_large_container?: boolean;
}
export interface UiaReadResult {
  window: { title: string; process_name: string; bounds: UiaBounds };
  targets: UiaTarget[];
  snapshot_token: string;
}

/**
 * Map the Rust click_strategy hint to a geometry ClickStrategy, PRESERVING the
 * precision-relevant strategies (`visual_refine`, `toolbar_multi_anchor`) instead
 * of collapsing everything unknown to `safe_inset`. Losing `visual_refine` here was
 * the core V2 bug: a large container then got a plain safe-inset center click
 * (the 20–30px miss) instead of triggering a crop/refine.
 */
export function clickStrategyFor(t: UiaTarget): ClickStrategy {
  switch ((t.click_strategy ?? '').toLowerCase()) {
    case 'left_glyph': return 'left_glyph';
    case 'invoke': return 'invoke';
    case 'toolbar_multi_anchor': return 'toolbar_multi_anchor';
    case 'visual_refine': return 'visual_refine';
    case 'safe_inset': return 'safe_inset';
    default: return 'safe_inset';
  }
}

/** Normalize one raw desktop_read JSON result into ScreenElements. */
export function uiaTargetsToElements(raw: UiaReadResult): ScreenElement[] {
  const out: ScreenElement[] = [];
  const token = raw.snapshot_token;
  for (const t of raw.targets ?? []) {
    const bbox = boundsToBBox(t.bounds);
    if (!isUsableBBox(bbox)) continue;          // drop zero/tiny
    if (t.visible === false) continue;          // drop offscreen
    const strategy = clickStrategyFor(t);
    const clickable =
      t.can_invoke || t.is_keyboard_focusable ||
      /button|menuitem|tabitem|listitem|checkbox|radiobutton|hyperlink|splitbutton|edit|combobox/i
        .test(t.role);
    // An element needs re-grounding before a pixel click when Rust flagged it
    // visual_refine, marked it low-precision, or it's a big container AND has no
    // reliable programmatic invoke to fall back on.
    const requires_refine =
      t.click_strategy === 'visual_refine' ||
      t.precision_level === 'low' ||
      (!!t.is_large_container && !t.can_invoke);
    out.push({
      id: `uia_${t.id}`,
      source: 'uia',
      role: t.role,
      name: t.name ?? '',
      text: t.name ?? '',
      bbox,
      center: bboxCenter(bbox),
      clickable_point: safeClickPoint(bbox, strategy),
      clickable,
      confidence: typeof t.target_confidence === 'number' ? t.target_confidence : 0.5,
      visible: true, // guarded above (offscreen targets are skipped)
      metadata: {
        uiaId: t.id,
        snapshot_token: token,
        automation_id: t.automation_id ?? undefined,
        can_invoke: t.can_invoke,
        can_scroll: t.can_scroll,
        is_keyboard_focusable: t.is_keyboard_focusable,
        focused: t.focused,
        enabled: t.enabled,
        // ── Precision V3 metadata (preserved end-to-end for planner + executor) ──
        precision_level: t.precision_level,
        click_strategy: t.click_strategy,
        target_confidence: t.target_confidence,
        children_count: t.children_count,
        is_large_container: t.is_large_container,
        requires_refine,
        window_title: t.window_title,
      },
    });
  }
  return out;
}

/**
 * Read the foreground window's UIA tree and return ScreenElements + the window
 * info. Best-effort: throws are caught by the caller (buildScreenState), which
 * simply yields no UIA elements rather than failing the whole pipeline.
 */
export async function readUiaElements(
  mode: 'semantic' | 'precision' = 'semantic',
  region?: { x: number; y: number; width: number; height: number } | null,
): Promise<{ elements: ScreenElement[]; window: UiaReadResult['window']; snapshot_token: string }> {
  const rawStr = await invoke<string>('desktop_read', { mode, region: region ?? null });
  const raw = JSON.parse(rawStr) as UiaReadResult;
  return {
    elements: uiaTargetsToElements(raw),
    window: raw.window,
    snapshot_token: raw.snapshot_token,
  };
}
