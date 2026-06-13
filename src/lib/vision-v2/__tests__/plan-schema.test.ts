import { describe, it, expect } from 'vitest';
import { validateActionPlan } from '../plan-schema';

describe('validateActionPlan', () => {
  it('accepts a well-formed click_element plan', () => {
    const r = validateActionPlan({
      action: 'click_element',
      target: { element_id: 'e_104' },
      reason: 'open Extensions',
      confidence: 0.92,
      expect: { type: 'text_appears', value: 'Extensions', timeout_ms: 2500, required: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.action).toBe('click_element');
      expect(r.plan.target?.element_id).toBe('e_104');
      expect(r.plan.expect?.type).toBe('text_appears');
    }
  });

  it('rejects click_element without element_id', () => {
    const r = validateActionPlan({ action: 'click_element', reason: 'x', confidence: 0.5 });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown action', () => {
    const r = validateActionPlan({ action: 'teleport', reason: 'x', confidence: 1 });
    expect(r.ok).toBe(false);
  });

  it('normalizes a "ctrl+shift+x" hotkey string into keys[]', () => {
    const r = validateActionPlan({ action: 'hotkey', keys: 'ctrl+shift+x', reason: 'x', confidence: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.keys).toEqual(['ctrl', 'shift', 'x']);
  });

  it('accepts raw_click with top-level x/y and folds them into target', () => {
    const r = validateActionPlan({ action: 'raw_click', x: 817, y: 443, reason: 'last resort', confidence: 0.8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.target?.x).toBe(817);
      expect(r.plan.target?.y).toBe(443);
    }
  });

  it('rejects raw_click without coordinates', () => {
    const r = validateActionPlan({ action: 'raw_click', reason: 'x', confidence: 1 });
    expect(r.ok).toBe(false);
  });

  it('maps click_text top-level text into target.text', () => {
    const r = validateActionPlan({ action: 'click_text', text: 'Extensions', reason: 'x', confidence: 0.7 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.target?.text).toBe('Extensions');
  });
});
