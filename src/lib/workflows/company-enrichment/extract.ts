import { extractContactInfo, extractPage } from '../../web-search/provider';
import type { EnrichmentResult, EnrichmentWorkItem } from './types';
import { scoreCandidate } from './score';

export async function extractCompanyResult(item: EnrichmentWorkItem): Promise<EnrichmentResult> {
  const ranked = item.sources
    .map((source) => ({ source, score: scoreCandidate(item.companyName, source) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    return { rowIndex: item.rowIndex, companyName: item.companyName, values: { notes: 'No search candidates found' }, sources: [], status: 'not_found' };
  }
  if (ranked[1] && Math.abs(best.score - ranked[1].score) < 0.12) {
    return { rowIndex: item.rowIndex, companyName: item.companyName, values: { source_url: best.source.url, confidence: best.score.toFixed(2), notes: 'Ambiguous search candidates' }, sources: ranked.slice(0, 3).map((r) => r.source), status: 'ambiguous' };
  }
  let pageText = `${best.source.title ?? ''}\n${best.source.snippet ?? ''}`;
  try {
    const page = await extractPage(best.source.url, 10_000);
    pageText = `${page.title ?? ''}\n${page.text}`;
  } catch {
    // Search snippets are still useful evidence when a page blocks direct fetch.
  }
  const contact = extractContactInfo(best.source.url, pageText);
  const firstEmail = contact.emails[0] ?? '';
  const firstPhone = contact.phones[0] ?? '';
  return {
    rowIndex: item.rowIndex,
    companyName: item.companyName,
    values: {
      website: best.source.url,
      email: firstEmail,
      phone: firstPhone,
      linkedin: contact.links.linkedin,
      source_url: best.source.url,
      confidence: best.score.toFixed(2),
      notes: firstEmail || firstPhone ? '' : 'Contact details not confidently found on fetched source',
    },
    sources: [best.source],
    status: best.score >= 0.52 ? 'found' : 'ambiguous',
  };
}
