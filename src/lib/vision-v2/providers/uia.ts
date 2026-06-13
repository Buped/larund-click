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

/** Map the Rust click_strategy hint to a geometry ClickStrategy. */
function clickStrategyFor(t: UiaTarget): ClickStrategy {
  const s = (t.click_strategy ?? '').toLowerCase();
  if (s === 'left_glyph') return 'left_glyph';
  if (s === 'invoke') return 'center';
  return 'safe_inset';
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
        precision_level: t.precision_level,
        click_strategy: t.click_strategy,
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
): Promise<{ elements: ScreenElement[]; window: UiaReadResult['window']; snapshot_token: string }> {
  const rawStr = await invoke<string>('desktop_read', { mode, region: null });
  const raw = JSON.parse(rawStr) as UiaReadResult;
  return {
    elements: uiaTargetsToElements(raw),
    window: raw.window,
    snapshot_token: raw.snapshot_token,
  };
}
