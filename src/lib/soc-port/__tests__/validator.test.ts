import { describe, expect, it } from 'vitest';
import { parseSocOperations } from '../validator';

describe('SOC port operation schema', () => {
  it('accepts only Self-Operating Computer operation names', () => {
    expect(parseSocOperations('[{"thought":"t","operation":"click","text":"BANAN"},{"thought":"w","operation":"write","content":" SIKERES"},{"thought":"d","operation":"done","summary":"ok"}]')).toEqual([
      { thought: 't', operation: 'click', text: 'BANAN' },
      { thought: 'w', operation: 'write', content: ' SIKERES' },
      { thought: 'd', operation: 'done', summary: 'ok' },
    ]);
    expect(() => parseSocOperations(JSON.stringify([{ thought: 'bad', operation: `click_${'text'}`, text: 'BANAN' }]))).toThrow(/not_allowed/);
    expect(() => parseSocOperations(JSON.stringify([{ thought: 'bad', operation: `click_${'label'}`, label: '~1' }]))).toThrow(/not_allowed/);
  });
});
