import { describe, it, expect } from 'vitest';
import { sanitizeTitle } from '../title';

describe('sanitizeTitle', () => {
  it('strips wrapping quotes and trailing period', () => {
    expect(sanitizeTitle('"Invoice Filing and Logging."', 'fallback')).toBe('Invoice Filing and Logging');
  });

  it('collapses whitespace', () => {
    expect(sanitizeTitle('  Landing   Page   Launch Plan ', 'fb')).toBe('Landing Page Launch Plan');
  });

  it('falls back to a clipped first message when empty', () => {
    expect(sanitizeTitle('', 'Van kettő számla a mappában')).toBe('Van kettő számla a mappában');
  });

  it('truncates very long titles', () => {
    const long = 'A'.repeat(120);
    const out = sanitizeTitle(long, 'fb');
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith('…')).toBe(true);
  });

  it('keeps Hungarian characters intact', () => {
    expect(sanitizeTitle('Számlák rendezése és naplózás', 'fb')).toBe('Számlák rendezése és naplózás');
  });

  it('uses "New chat" when both title and fallback are empty', () => {
    expect(sanitizeTitle('', '')).toBe('New chat');
  });
});
