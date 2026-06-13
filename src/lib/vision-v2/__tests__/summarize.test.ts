import { describe, it, expect } from 'vitest';
import { summarizeElements } from '../screen-state';
import type { ScreenElement, BBox } from '../types';

function el(p: Partial<ScreenElement> & { id: string; source: ScreenElement['source'] }): ScreenElement {
  const bbox: BBox = p.bbox ?? [100, 100, 200, 140];
  return {
    role: 'Button', name: 'OK', text: 'OK', bbox, center: [150, 120], clickable_point: [150, 120],
    clickable: true, confidence: 0.8, visible: true, ...p,
  } as ScreenElement;
}

describe('summarizeElements precision fields', () => {
  it('includes bbox, size, conf, precision, strategy, large, clickable', () => {
    const line = summarizeElements([el({
      id: 'uia_42', source: 'uia', role: 'ListItem', name: 'Game name', bbox: [420, 240, 610, 350],
      metadata: { precision_level: 'medium', click_strategy: 'visual_refine', target_confidence: 0.72 },
    })]);
    expect(line).toContain('uia_42 [uia/ListItem] "Game name"');
    expect(line).toContain('bbox=[420,240,610,350]');
    expect(line).toContain('size=190x110');
    expect(line).toContain('conf=0.72');
    expect(line).toContain('precision=medium');
    expect(line).toContain('strategy=visual_refine');
    expect(line).toContain('clickable=true');
  });

  it('flags large containers and uses @web for DOM/pixelless', () => {
    const lines = summarizeElements([
      el({ id: 'uia_p', source: 'uia', role: 'Pane', name: 'Home', bbox: [0, 0, 600, 400], metadata: { is_large_container: true } }),
      el({ id: 'dom_0', source: 'dom', role: 'Button', name: 'Sign in', bbox: [0, 0, 0, 0] }),
    ]);
    expect(lines).toContain('large=true');
    expect(lines).toContain('@web');
  });
});
