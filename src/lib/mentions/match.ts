// Pure mention-query matching, isolated from the DOM so the open/close decision is
// unit-testable. The mention dropdown must open ONLY when the caret sits at the end
// of a real `@…` token — never on an empty or freshly-cleared editor.

export interface MentionQueryMatch {
  /** The text after `@` (may be empty when the user just typed `@`). */
  query: string;
  /** Length of the matched `@token` (including the `@`), for caret math. */
  tokenLength: number;
}

/**
 * Given the text immediately before the caret, return the active `@query` if the
 * caret is at the end of an `@…` token, else null.
 *
 *   matchMentionQuery('')            -> null   (empty editor)
 *   matchMentionQuery('hello')       -> null   (plain text)
 *   matchMentionQuery('hello world') -> null
 *   matchMentionQuery('@')           -> { query: '' }      (dropdown opens)
 *   matchMentionQuery('hi @sh')      -> { query: 'sh' }
 *   matchMentionQuery('a@b')         -> null   (no word boundary before @)
 */
export function matchMentionQuery(beforeCaret: string): MentionQueryMatch | null {
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return { query: match[2], tokenLength: match[2].length + 1 };
}
