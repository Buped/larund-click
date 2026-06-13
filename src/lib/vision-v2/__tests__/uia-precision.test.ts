import { describe, it, expect } from 'vitest';
import { clickStrategyFor, uiaTargetsToElements } from '../providers/uia';

function target(p: Record<string, unknown>) {
  return {
    id: 'fg|1', name: 'X', role: 'Button', automation_id: null,
    bounds: { x: 100, y: 100, width: 60, height: 32 },
    enabled: true, visible: true, focused: false, window_title: 'W',
    can_invoke: true, can_scroll: false, is_keyboard_focusable: true, ...p,
  } as never;
}

describe('clickStrategyFor preserves precision strategies', () => {
  it('keeps visual_refine (does NOT collapse to safe_inset)', () => {
    expect(clickStrategyFor(target({ click_strategy: 'visual_refine' }))).toBe('visual_refine');
  });
  it('keeps toolbar_multi_anchor', () => {
    expect(clickStrategyFor(target({ click_strategy: 'toolbar_multi_anchor' }))).toBe('toolbar_multi_anchor');
  });
  it('maps invoke and left_glyph', () => {
    expect(clickStrategyFor(target({ click_strategy: 'invoke' }))).toBe('invoke');
    expect(clickStrategyFor(target({ click_strategy: 'left_glyph' }))).toBe('left_glyph');
  });
  it('defaults unknown to safe_inset', () => {
    expect(clickStrategyFor(target({ click_strategy: 'weird' }))).toBe('safe_inset');
  });
});

describe('uiaTargetsToElements carries precision metadata + requires_refine', () => {
  it('preserves click_strategy/precision/children/large and sets requires_refine for visual_refine', () => {
    const raw = {
      window: { title: 'W', process_name: 'P', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      snapshot_token: 'tok',
      targets: [target({
        id: 'fg|c', name: 'Home', role: 'Pane', bounds: { x: 400, y: 200, width: 500, height: 400 },
        can_invoke: false, click_strategy: 'visual_refine', precision_level: 'low',
        target_confidence: 0.4, children_count: 12, is_large_container: true,
      })],
    } as never;
    const [e] = uiaTargetsToElements(raw);
    expect(e.metadata?.click_strategy).toBe('visual_refine');
    expect(e.metadata?.precision_level).toBe('low');
    expect(e.metadata?.target_confidence).toBe(0.4);
    expect(e.metadata?.children_count).toBe(12);
    expect(e.metadata?.is_large_container).toBe(true);
    expect(e.metadata?.requires_refine).toBe(true);
  });

  it('does NOT flag a small invokable button for refine', () => {
    const raw = {
      window: { title: 'W', process_name: 'P', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      snapshot_token: 'tok',
      targets: [target({ id: 'fg|b', name: 'OK', role: 'Button', click_strategy: 'invoke', precision_level: 'high', target_confidence: 0.9 })],
    } as never;
    const [e] = uiaTargetsToElements(raw);
    expect(e.metadata?.requires_refine).toBe(false);
  });
});
