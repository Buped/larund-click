import { describe, it, expect, beforeEach } from 'vitest';
import { isVisionV2Enabled } from '../config';

// Minimal localStorage stub for the Node test environment.
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  key: () => null, length: 0,
} as Storage;

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe('isVisionV2Enabled', () => {
  it('is false by default (no env, no localStorage)', () => {
    expect(isVisionV2Enabled()).toBe(false);
  });
  it('is true when localStorage flag is set', () => {
    store['larund_click_vision_v2'] = 'true';
    expect(isVisionV2Enabled()).toBe(true);
  });
  it('is false for any non-"true" value', () => {
    store['larund_click_vision_v2'] = 'yes';
    expect(isVisionV2Enabled()).toBe(false);
  });
});
