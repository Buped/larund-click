import { describe, expect, it } from 'vitest';
import { cleanWebText, looksMojibake, repairMojibake } from '../encoding';

describe('web text encoding cleanup', () => {
  it('does not change already-correct Hungarian text', () => {
    const text = 'Magyarország népességének főbb mutatói júniusban';
    expect(looksMojibake(text)).toBe(false);
    expect(cleanWebText(text)).toBe(text);
  });

  it('repairs common UTF-8-as-Latin1 mojibake', () => {
    expect(repairMojibake('MagyarorszÃ¡g nÃ©pessÃ©ge')).toBe('Magyarország népessége');
  });

  it('leaves replacement-character text when original bytes are lost', () => {
    expect(repairMojibake('n�pess�g')).toBe('n�pess�g');
  });
});
