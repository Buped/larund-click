// Turns the operator model's raw turn into a human-readable progress line.
//
// Each operator turn is "1-2 short reasoning sentences, then exactly one JSON
// action". The reasoning prose used to be discarded. We now surface it as a
// `narration` step so the chat reads like a coworker explaining what they're
// doing ("I found 2 invoices, creating the folders now") instead of a raw tool
// log. Pure + deterministic so it is unit-testable.

/** Strip the trailing JSON action and any code fences, returning the prose. */
export function extractNarration(aiResponse: string): string {
  if (!aiResponse) return '';
  let text = aiResponse.replace(/```(?:json)?/gi, '').replace(/```/g, '');

  // Remove the final top-level JSON object (the action). Find the last balanced
  // {...} and cut from its start. We use the last '{' that has a matching '}' at
  // the very end, mirroring the parser's "JSON is the final line" contract.
  const end = text.lastIndexOf('}');
  if (end !== -1) {
    const start = findMatchingOpen(text, end);
    if (start !== -1) text = text.slice(0, start);
  }

  return cleanProse(text);
}

/** Walk back from a closing brace to its matching opening brace. */
function findMatchingOpen(text: string, closeIdx: number): number {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const NOISE = /^(here('s| is)|ok(ay)?|sure|alright|now|next|let me|i will|i'll|i am going to|i'm going to)[,:]?\s*/i;

function cleanProse(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Drop stacked leading filler openers ("Okay, let me …") so the line reads as
  // content. Bounded so we never strip real words.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(NOISE, '').trim();
    if (next === s) break;
    s = next;
  }
  if (s && /[a-z0-9áéíóöőúüű]/i.test(s[0])) s = s[0].toUpperCase() + s.slice(1);
  // Guard against accidentally surfacing leftover JSON-ish fragments.
  if (/^["{[]/.test(s) || /"action"\s*:/.test(s)) return '';
  return s.length > 280 ? `${s.slice(0, 279)}…` : s;
}

/** Is this prose substantial enough to show as a narration line? */
export function isMeaningfulNarration(prose: string): boolean {
  return prose.length >= 12 && /\s/.test(prose);
}
