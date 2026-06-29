import { describe, it, expect } from 'vitest';
import { extractNarration, isMeaningfulNarration, sanitizeUserVisibleNarration } from '../narration';

describe('extractNarration', () => {
  it('returns the prose before a trailing JSON action', () => {
    const turn = 'I found 2 invoices — creating the bookkeeping folders next.\n{"action":"file.mkdir","path":"~/Books"}';
    expect(extractNarration(turn)).toBe('I found 2 invoices — creating the bookkeeping folders next.');
  });

  it('strips a leading filler opener and capitalizes', () => {
    const turn = "Okay, let me read the file first.\n{\"action\":\"file.read\",\"path\":\"a.txt\"}";
    const out = extractNarration(turn);
    expect(out).toMatch(/^Read the file first\.?$/i);
  });

  it('handles fenced JSON', () => {
    const turn = 'Reading the page to confirm the rows.\n```json\n{"action":"browser.read"}\n```';
    expect(extractNarration(turn)).toBe('Reading the page to confirm the rows.');
  });

  it('returns empty when there is only an action object', () => {
    expect(extractNarration('{"action":"task.complete","summary":"done"}')).toBe('');
  });

  it('does not leak JSON fragments as narration', () => {
    const out = extractNarration('{"action":"file.read","path":"x"}');
    expect(isMeaningfulNarration(out)).toBe(false);
  });

  it('isMeaningfulNarration rejects tiny strings', () => {
    expect(isMeaningfulNarration('ok')).toBe(false);
    expect(isMeaningfulNarration('Creating the folder now.')).toBe(true);
  });

  it('removes internal execution-policy chatter from visible narration', () => {
    const out = sanitizeUserVisibleNarration('No-mouse operator. Working via CLI and files. No mouse/cursor/visual control. Reading the source now.');
    expect(out).toBe('Working via CLI and files. Reading the source now.');
  });
});
