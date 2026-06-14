import { describe, expect, it } from 'vitest';
import { validateSocOperations } from '../validator';

describe('SOC operation validation', () => {
  it('accepts the supported SOC operations as a JSON array', () => {
    const ops = validateSocOperations(JSON.stringify([
      { thought: 'click text', operation: 'click_text', text: 'Ground War' },
      { thought: 'press enter', operation: 'press', keys: ['enter'] },
      { thought: 'done', operation: 'done', summary: 'Game detail is visible' },
    ]));
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({ thought: 'click text', operation: 'click_text', text: 'Ground War' });
  });

  it('rejects invalid JSON shape and unsafe coordinates', () => {
    expect(() => validateSocOperations('{"operation":"click"}')).toThrow(/json_array/);
    expect(() => validateSocOperations('[{"thought":"bad","operation":"click","x":2,"y":0.5}]')).toThrow(/out_of_range/);
    expect(() => validateSocOperations('[{"thought":"bad","operation":"click_label","label":"12"}]')).toThrow(/label/);
  });
});
