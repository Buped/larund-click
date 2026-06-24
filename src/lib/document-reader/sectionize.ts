import type { DocumentSection, SectionSummarizer } from './types';

// Tunables for the map-reduce condensation of long documents.
const MAX_SECTIONS = 24; // cap the number of cheap-model calls per document
const MIN_SECTION_CHARS = 2_000;
const OVERLAP_CHARS = 300; // overlap between fixed windows so context isn't cut mid-thought
const EXTRACTIVE_HEAD = 600; // chars kept per section when no AI summarizer is available

/**
 * Split extracted document text into logical sections. Preference order:
 *  1. Form-feed page breaks (`\f`) — produced by PDF/office text extraction.
 *  2. Markdown-style headings (lines starting with `#`).
 *  3. Fixed-size overlapping windows.
 * The result is always at most MAX_SECTIONS sections (merged/re-windowed to fit).
 */
export function splitIntoSections(text: string): DocumentSection[] {
  const trimmed = text ?? '';
  if (!trimmed) return [];

  let raw: { label: string; start: number; end: number }[] = [];

  if (trimmed.includes('\f')) {
    let offset = 0;
    const pages = trimmed.split('\f');
    pages.forEach((page, i) => {
      const start = offset;
      const end = start + page.length;
      offset = end + 1; // account for the consumed \f
      if (page.trim()) raw.push({ label: `Page ${i + 1}`, start, end });
    });
  } else {
    const headingRe = /^#{1,4}\s+.+$/gm;
    const matches = [...trimmed.matchAll(headingRe)];
    if (matches.length >= 3) {
      for (let i = 0; i < matches.length; i += 1) {
        const start = matches[i].index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? trimmed.length) : trimmed.length;
        const label = matches[i][0].replace(/^#+\s*/, '').slice(0, 80).trim();
        raw.push({ label: label || `Section ${i + 1}`, start, end });
      }
      // capture any preamble before the first heading
      const firstStart = matches[0].index ?? 0;
      if (firstStart > MIN_SECTION_CHARS) raw.unshift({ label: 'Intro', start: 0, end: firstStart });
    }
  }

  if (raw.length === 0) {
    raw = windowRanges(trimmed.length).map((r, i) => ({ label: `Part ${i + 1}`, start: r[0], end: r[1] }));
  }

  // If a heading/page split produced too many sections, re-window into MAX_SECTIONS.
  if (raw.length > MAX_SECTIONS) {
    raw = windowRanges(trimmed.length).map((r, i) => ({ label: `Part ${i + 1}`, start: r[0], end: r[1] }));
  }

  const total = raw.length;
  return raw.map((r, i) => ({
    index: i,
    label: total > 1 && /^(Part|Section)/.test(r.label) ? `${r.label} (${i + 1}/${total})` : r.label,
    range: [r.start, r.end] as [number, number],
    text: trimmed.slice(r.start, r.end).trim(),
  }));
}

/** Compute up to MAX_SECTIONS overlapping windows covering [0, length). */
function windowRanges(length: number): Array<[number, number]> {
  const size = Math.max(MIN_SECTION_CHARS, Math.ceil(length / MAX_SECTIONS));
  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (start < length) {
    const end = Math.min(length, start + size);
    ranges.push([start, end]);
    if (end >= length) break;
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return ranges;
}

/**
 * Map-reduce condense a long document. Each section is summarized with the cheap
 * `summarizer` (or extractively when none is provided). Returns the reduced text
 * (section summaries with source markers) plus the sections enriched with their
 * summaries — the full per-section text is retained for drill-back.
 */
export async function summarizeSections(
  sections: DocumentSection[],
  summarizer?: SectionSummarizer,
): Promise<{ reducedText: string; sections: DocumentSection[] }> {
  const enriched: DocumentSection[] = [];

  if (summarizer) {
    // Bounded concurrency to avoid a request spike on very long documents.
    const BATCH = 4;
    for (let i = 0; i < sections.length; i += BATCH) {
      const batch = sections.slice(i, i + BATCH);
      const summaries = await Promise.all(
        batch.map(async (s) => {
          try {
            const summary = await summarizer({
              text: s.text,
              hint: `This is "${s.label}" of a longer document. Summarize its key facts, figures, names, and decisions in 2-4 sentences. Preserve concrete numbers.`,
            });
            return summary.trim() || extractive(s.text);
          } catch {
            return extractive(s.text);
          }
        }),
      );
      batch.forEach((s, j) => enriched.push({ ...s, summary: summaries[j] }));
    }
  } else {
    for (const s of sections) enriched.push({ ...s, summary: extractive(s.text) });
  }

  const reducedText = enriched.map((s) => `[§ ${s.label}]\n${s.summary}`).join('\n\n');
  return { reducedText, sections: enriched };
}

function extractive(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= EXTRACTIVE_HEAD) return compact;
  return `${compact.slice(0, EXTRACTIVE_HEAD).trim()}…`;
}
