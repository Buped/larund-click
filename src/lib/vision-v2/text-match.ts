// Vision Mouse V2 — fuzzy text matching for click_text / click_label.
//
// When the planner says click_text "Extensions", we have to find the best
// element whose visible text matches — tolerant of case, whitespace, accents,
// and partial/substring hits. Pure + unit-tested.

/** Lowercase, strip accents, collapse non-alphanumerics to single spaces. */
export function normalizeText(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Similarity in 0..1 between a query and a candidate, after normalization.
 *   exact            → 1.0
 *   query ⊂ candidate (or vice-versa) → 0.85–0.95 (favours shorter extra text)
 *   otherwise        → edit-distance ratio
 */
export function textSimilarity(query: string, candidate: string): number {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  if (c.includes(q) || q.includes(c)) {
    const shorter = Math.min(q.length, c.length);
    const longer = Math.max(q.length, c.length);
    return 0.85 + 0.1 * (shorter / longer);
  }

  const dist = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  return maxLen === 0 ? 0 : Math.max(0, 1 - dist / maxLen);
}

export interface TextMatch<T> {
  item: T;
  score: number;
}

/**
 * Best fuzzy match for `query` among `items`, keyed by `getText`. Returns null
 * when nothing clears `threshold` (default 0.5). Ties broken by shorter text
 * (more specific).
 */
export function bestTextMatch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
  threshold = 0.5,
): TextMatch<T> | null {
  let best: TextMatch<T> | null = null;
  for (const item of items) {
    const score = textSimilarity(query, getText(item));
    if (score < threshold) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && getText(item).length < getText(best.item).length)
    ) {
      best = { item, score };
    }
  }
  return best;
}
