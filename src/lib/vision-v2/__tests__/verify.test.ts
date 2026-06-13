import { describe, it, expect } from 'vitest';
import { verifyV2, textPresent, screenshotDiffRatio } from '../verify';
import type { ScreenState, ScreenElement } from '../types';

function state(p: Partial<ScreenState>): ScreenState {
  return {
    screenshot_width: 1920, screenshot_height: 1080, screen_width: 1920, screen_height: 1080,
    dpi_scale: 1, active_window_title: '', active_app_name: '', elements: [],
    timestamp: new Date().toISOString(), ...p,
  };
}
function elem(name: string, extra: Partial<ScreenElement> = {}): ScreenElement {
  return {
    id: name, source: 'uia', role: 'Text', name, text: name, bbox: [0, 0, 10, 10],
    center: [5, 5], clickable_point: [5, 5], clickable: true, confidence: 0.6, visible: true, ...extra,
  };
}

describe('verifyV2', () => {
  it('none always verifies', () => {
    expect(verifyV2({ type: 'none' }, state({}), state({})).verified).toBe(true);
    expect(verifyV2(undefined, state({}), state({})).verified).toBe(true);
  });

  it('text_appears passes when the after-state contains the text', () => {
    const before = state({ elements: [] });
    const after = state({ elements: [elem('Extensions')] });
    expect(verifyV2({ type: 'text_appears', value: 'Extensions' }, before, after).verified).toBe(true);
    expect(verifyV2({ type: 'text_appears', value: 'Nope' }, before, after).verified).toBe(false);
  });

  it('text_disappears passes only when the text is gone', () => {
    const before = state({ elements: [elem('Dialog')] });
    const after = state({ elements: [] });
    expect(verifyV2({ type: 'text_disappears', value: 'Dialog' }, before, after).verified).toBe(true);
    expect(verifyV2({ type: 'text_disappears', value: 'Dialog' }, before, before).verified).toBe(false);
  });

  it('window_changed compares titles', () => {
    const a = state({ active_window_title: 'Notepad' });
    const b = state({ active_window_title: 'Google Chrome' });
    expect(verifyV2({ type: 'window_changed' }, a, b).verified).toBe(true);
    expect(verifyV2({ type: 'window_changed' }, a, a).verified).toBe(false);
  });

  it('url_changed compares browser_url', () => {
    const a = state({ browser_url: 'https://a.com' });
    const b = state({ browser_url: 'https://b.com' });
    expect(verifyV2({ type: 'url_changed' }, a, b).verified).toBe(true);
  });

  it('focus_changed compares the focused element id', () => {
    const a = state({ elements: [elem('f1', { metadata: { focused: true } })] });
    const b = state({ elements: [elem('f2', { metadata: { focused: true } })] });
    expect(verifyV2({ type: 'focus_changed' }, a, b).verified).toBe(true);
  });
});

describe('helpers', () => {
  it('textPresent matches window title and elements (normalized)', () => {
    const s = state({ active_window_title: 'Visual Studio Code', elements: [elem('Extensions')] });
    expect(textPresent(s, 'visual studio')).toBe(true);
    expect(textPresent(s, 'EXTENSIONS')).toBe(true);
    expect(textPresent(s, 'terminal')).toBe(false);
  });

  it('screenshotDiffRatio is 0 for identical and >0 for different', () => {
    expect(screenshotDiffRatio('abc', 'abc')).toBe(0);
    expect(screenshotDiffRatio('aaaaaaaa', 'bbbbbbbb')).toBeGreaterThan(0);
  });
});
