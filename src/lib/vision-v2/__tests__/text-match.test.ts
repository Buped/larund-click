import { describe, it, expect } from 'vitest';
import { normalizeText, textSimilarity, bestTextMatch } from '../text-match';

describe('normalizeText', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeText('  Sign   IN ')).toBe('sign in');
  });
  it('strips accents and punctuation', () => {
    expect(normalizeText('Beállítások…')).toBe('beallitasok');
    expect(normalizeText('New project!')).toBe('new project');
  });
});

describe('textSimilarity', () => {
  it('is 1 for an exact (case/space-insensitive) match', () => {
    expect(textSimilarity('Extensions', 'extensions')).toBe(1);
  });
  it('is high for a substring match', () => {
    expect(textSimilarity('Save', 'Save As...')).toBeGreaterThan(0.8);
  });
  it('is moderate for a typo', () => {
    const s = textSimilarity('Setings', 'Settings');
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1);
  });
  it('is low for unrelated text', () => {
    expect(textSimilarity('Extensions', 'Terminal')).toBeLessThan(0.5);
  });
});

describe('bestTextMatch', () => {
  const items = [
    { id: 'a', label: 'Extensions' },
    { id: 'b', label: 'Explorer' },
    { id: 'c', label: 'Terminal' },
  ];

  it('picks the best fuzzy match over a threshold', () => {
    const m = bestTextMatch('extensions', items, (i) => i.label);
    expect(m?.item.id).toBe('a');
  });

  it('returns null when nothing clears the threshold', () => {
    const m = bestTextMatch('zzzz', items, (i) => i.label, 0.5);
    expect(m).toBeNull();
  });

  it('prefers the shorter (more specific) text on a tie', () => {
    const tie = [
      { id: 'long', label: 'New' },
      { id: 'longer', label: 'New project window' },
    ];
    const m = bestTextMatch('new', tie, (i) => i.label);
    expect(m?.item.id).toBe('long');
  });
});
