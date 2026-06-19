import { describe, it, expect } from 'vitest';
import { matchMentionQuery } from '../match';

// These cover the chat mention-dropdown open/close decision. The dropdown opens iff
// matchMentionQuery(...) is non-null.
describe('matchMentionQuery (mention dropdown open/close)', () => {
  it('plain text after send → closed (null)', () => {
    expect(matchMentionQuery('hello')).toBeNull();
    expect(matchMentionQuery('hello world')).toBeNull();
  });

  it('empty editor (after clear) → closed (null)', () => {
    expect(matchMentionQuery('')).toBeNull();
  });

  it('typing "@" → open with empty query', () => {
    expect(matchMentionQuery('@')).toEqual({ query: '', tokenLength: 1 });
    expect(matchMentionQuery('hi @')).toEqual({ query: '', tokenLength: 1 });
  });

  it('typing "@word" → open with the query', () => {
    expect(matchMentionQuery('@sh')).toEqual({ query: 'sh', tokenLength: 3 });
    expect(matchMentionQuery('look at @Shopify')).toEqual({ query: 'Shopify', tokenLength: 8 });
  });

  it('@ in the middle of a word (no boundary) → closed', () => {
    expect(matchMentionQuery('email@domain')).toBeNull();
  });

  it('whitespace after the token closes it', () => {
    expect(matchMentionQuery('@shopify ')).toBeNull();
  });
});
