import { describe, it, expect } from 'vitest';
import {
  requiresPreClickRefine, evaluatePreClickRefine, specificityScore, isLargeContainer, isCustomUiApp,
} from '../precision';
import type { ScreenElement, ScreenState, BBox } from '../types';

function el(p: Partial<ScreenElement> & { id: string; source: ScreenElement['source'] }): ScreenElement {
  const bbox: BBox = p.bbox ?? [100, 100, 160, 140];
  return {
    role: 'Button', name: 'OK', text: 'OK', bbox,
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number],
    clickable_point: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number],
    clickable: true, confidence: 0.8, visible: true, ...p,
  } as ScreenElement;
}

function state(p: Partial<ScreenState> = {}): ScreenState {
  return {
    screenshot_width: 1920, screenshot_height: 1080, screen_width: 1920, screen_height: 1080,
    dpi_scale: 1, active_window_title: 'Test', active_app_name: 'test', elements: [],
    timestamp: new Date().toISOString(), ...p,
  };
}

describe('requiresPreClickRefine', () => {
  it('TRUE for a large UIA Pane container', () => {
    const big = el({
      id: 'uia_1', source: 'uia', role: 'Pane', name: 'Recently Played',
      bbox: [400, 200, 900, 600],
      metadata: { is_large_container: true, click_strategy: 'visual_refine', precision_level: 'low', target_confidence: 0.4 },
    });
    const d = evaluatePreClickRefine(big, state());
    expect(d.refine).toBe(true);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(requiresPreClickRefine(big, state())).toBe(true);
  });

  it('TRUE when strategy is visual_refine even if bbox is moderate', () => {
    const e = el({
      id: 'uia_2', source: 'uia', role: 'Group', bbox: [0, 0, 150, 90],
      metadata: { click_strategy: 'visual_refine', precision_level: 'medium', target_confidence: 0.7 },
    });
    expect(requiresPreClickRefine(e, state())).toBe(true);
  });

  it('TRUE for low precision', () => {
    const e = el({ id: 'uia_3', source: 'uia', metadata: { precision_level: 'low', target_confidence: 0.5 } });
    expect(requiresPreClickRefine(e, state())).toBe(true);
  });

  it('TRUE when bbox exceeds size thresholds', () => {
    const e = el({ id: 'uia_4', source: 'uia', role: 'Custom', bbox: [0, 0, 400, 300] });
    expect(requiresPreClickRefine(e, state())).toBe(true);
  });

  it('TRUE for many children', () => {
    const e = el({ id: 'uia_5', source: 'uia', metadata: { children_count: 12, target_confidence: 0.8 } });
    expect(requiresPreClickRefine(e, state())).toBe(true);
  });

  it('TRUE in a custom-UI app (Roblox) for a large-ish bbox', () => {
    const e = el({ id: 'uia_6', source: 'uia', role: 'Button', bbox: [0, 0, 200, 120], metadata: { target_confidence: 0.8, can_invoke: true } });
    expect(requiresPreClickRefine(e, state({ active_app_name: 'RobloxPlayerBeta', active_window_title: 'Roblox' }))).toBe(true);
  });

  it('FALSE for a small, high-confidence, invokable Button', () => {
    const e = el({
      id: 'uia_7', source: 'uia', role: 'Button', bbox: [100, 100, 140, 132],
      confidence: 0.9, metadata: { can_invoke: true, target_confidence: 0.9, precision_level: 'high', click_strategy: 'invoke' },
    });
    const d = evaluatePreClickRefine(e, state());
    expect(d.refine).toBe(false);
    expect(requiresPreClickRefine(e, state())).toBe(false);
  });

  it('FALSE for a DOM element (no pixels, precise by selector)', () => {
    const e = el({ id: 'dom_0', source: 'dom', role: 'Button', bbox: [0, 0, 0, 0], metadata: { domTarget: 'OK' } });
    expect(requiresPreClickRefine(e, state())).toBe(false);
  });
});

describe('specificityScore', () => {
  it('ranks a small specific child ABOVE a large container', () => {
    const container = el({
      id: 'uia_c', source: 'uia', role: 'List', name: 'Games', bbox: [400, 200, 900, 600],
      metadata: { is_large_container: true, children_count: 10, precision_level: 'low', target_confidence: 0.4 },
    });
    const child = el({
      id: 'uia_ch', source: 'uia', role: 'ListItem', name: 'Game card', bbox: [420, 240, 610, 350],
      metadata: { can_invoke: true, precision_level: 'high', target_confidence: 0.8 },
    });
    expect(specificityScore(child)).toBeGreaterThan(specificityScore(container));
  });

  it('rewards invokable named buttons and penalizes Panes', () => {
    const button = el({ id: 'b', source: 'uia', role: 'Button', name: 'Play', bbox: [0, 0, 80, 30], metadata: { can_invoke: true } });
    const pane = el({ id: 'p', source: 'uia', role: 'Pane', name: '', bbox: [0, 0, 600, 400], metadata: { is_large_container: true } });
    expect(specificityScore(button)).toBeGreaterThan(specificityScore(pane));
  });
});

describe('isLargeContainer / isCustomUiApp', () => {
  it('flags big bbox and container roles', () => {
    expect(isLargeContainer(el({ id: 'x', source: 'uia', role: 'Document', bbox: [0, 0, 50, 50] }))).toBe(true);
    expect(isLargeContainer(el({ id: 'y', source: 'uia', role: 'Button', bbox: [0, 0, 400, 50] }))).toBe(true);
    expect(isLargeContainer(el({ id: 'z', source: 'uia', role: 'Button', bbox: [0, 0, 60, 40] }))).toBe(false);
  });

  it('detects custom/game UI apps by name or title', () => {
    expect(isCustomUiApp({ active_app_name: 'RobloxPlayerBeta', active_window_title: 'Roblox' })).toBe(true);
    expect(isCustomUiApp({ active_app_name: 'Code', active_window_title: 'proj - Visual Studio Code' })).toBe(false);
  });
});
