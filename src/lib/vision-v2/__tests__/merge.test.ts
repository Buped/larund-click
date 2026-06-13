import { describe, it, expect } from 'vitest';
import { mergeElements } from '../merge';
import type { ScreenElement, BBox } from '../types';

function el(p: Partial<ScreenElement> & { id: string; source: ScreenElement['source'] }): ScreenElement {
  const bbox: BBox = p.bbox ?? [0, 0, 40, 20];
  return {
    role: 'Button', name: 'X', text: 'X', bbox, center: [20, 10], clickable_point: [20, 10],
    clickable: true, confidence: 0.5, visible: true, ...p,
  } as ScreenElement;
}

describe('mergeElements', () => {
  it('dedups overlapping pixel elements and keeps the higher-priority source', () => {
    const uia = el({ id: 'uia_1', source: 'uia', name: 'Sign in', role: 'Hyperlink', bbox: [0, 0, 100, 30] });
    const ocr = el({ id: 'ocr_1', source: 'ocr', name: 'Sign in', role: 'Text', bbox: [2, 2, 98, 28] });
    const { elements, stats } = mergeElements([[], [uia], [ocr], []]);
    expect(elements.length).toBe(1);
    expect(elements[0].source).toBe('uia'); // uia > ocr
    expect((elements[0].metadata?.sources as string[]).sort()).toEqual(['ocr', 'uia']);
    expect(stats.merged).toBe(1);
  });

  it('dedups DOM vs UIA by text+role even without pixel overlap', () => {
    const dom = el({ id: 'dom_0', source: 'dom', name: 'New project', role: 'Button', bbox: [0, 0, 0, 0] });
    const uia = el({ id: 'uia_9', source: 'uia', name: 'New project', role: 'Button', bbox: [500, 500, 620, 540] });
    const { elements } = mergeElements([[dom], [uia], [], []]);
    expect(elements.length).toBe(1);
    expect(elements[0].source).toBe('dom'); // dom is top priority
  });

  it('keeps distinct elements separate', () => {
    const a = el({ id: 'uia_1', source: 'uia', name: 'OK', bbox: [0, 0, 40, 20] });
    const b = el({ id: 'uia_2', source: 'uia', name: 'Cancel', bbox: [200, 0, 240, 20] });
    const { elements } = mergeElements([[], [a, b], [], []]);
    expect(elements.length).toBe(2);
  });

  it('filters zero-size and off-screen pixel elements', () => {
    const zero = el({ id: 'uia_z', source: 'uia', name: 'z', bbox: [10, 10, 11, 11] });
    const off = el({ id: 'uia_o', source: 'uia', name: 'o', bbox: [3000, 0, 3100, 40] });
    const ok = el({ id: 'uia_k', source: 'uia', name: 'k', bbox: [10, 10, 90, 50] });
    const { elements } = mergeElements([[], [zero, off, ok], [], []], { screenWidth: 1920, screenHeight: 1080 });
    expect(elements.map((e) => e.id)).toEqual(['uia_k']);
  });

  it('pushes clickable elements before non-clickable', () => {
    const noclick = el({ id: 'uia_t', source: 'uia', name: 'label', clickable: false, role: 'Text', bbox: [0, 0, 80, 20] });
    const click = el({ id: 'uia_b', source: 'uia', name: 'Go', clickable: true, role: 'Button', bbox: [300, 0, 360, 20] });
    const { elements } = mergeElements([[], [noclick, click], [], []]);
    expect(elements[0].id).toBe('uia_b');
  });
});
