import { describe, expect, it } from 'vitest';
import type { ScreenObservation, TargetCandidate } from '../types';
import { makeVerifiedMouseTarget } from '../mouse-kernel';

function observation(base64 = 'screen'): ScreenObservation {
  return {
    id: 'obs',
    capture: {
      base64,
      width: 800,
      height: 600,
      monitorId: 0,
      coordinateSpace: { kind: 'screen', origin: [0, 0], width: 800, height: 600, dpiScale: 1, monitorId: 0 },
    },
    activeWindowTitle: 'App',
    activeAppName: 'App.exe',
    candidates: [],
    ocrWords: [],
    providerLog: [],
    timestamp: '2026-06-13T00:00:00.000Z',
  };
}

const candidate: TargetCandidate = {
  id: 'target',
  source: 'vlm_grid',
  label: 'Ground War',
  text: 'Ground War',
  role: 'card',
  bbox: [100, 100, 140, 140],
  confidence: 0.82,
  clickable: true,
  reasons: ['test'],
};

describe('control-system mouse kernel', () => {
  it('requires a screenshot before constructing a verified target', () => {
    expect(() => makeVerifiedMouseTarget(observation(''), candidate, { target: 'Ground War', expected: 'Play' }))
      .toThrow('no_screenshot_no_click');
  });

  it('computes the click point from the bbox in code', () => {
    const target = makeVerifiedMouseTarget(observation(), candidate, { target: 'Ground War', expected: 'Play' });
    expect(target.clickPoint).toEqual([120, 118]);
    expect(target.bbox).toEqual([100, 100, 140, 140]);
  });

  it('rejects low-confidence targets before any mouse action', () => {
    expect(() => makeVerifiedMouseTarget(observation(), { ...candidate, confidence: 0.7 }, { target: 'Ground War', expected: 'Play' }))
      .toThrow('low_confidence_target');
  });
});
