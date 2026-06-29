import { webBatchSearch } from '../../web-search/provider';
import type { EnrichmentWorkItem, SourceCandidate } from './types';
import { buildCompanyQueries } from './planner';

export async function searchCompanies(items: EnrichmentWorkItem[], options: { concurrency?: number; locale?: string; country?: string } = {}): Promise<EnrichmentWorkItem[]> {
  const queryOwners: Array<{ rowIndex: number; query: string }> = [];
  for (const item of items) {
    for (const query of buildCompanyQueries(item.companyName, options.locale)) {
      queryOwners.push({ rowIndex: item.rowIndex, query });
    }
  }
  const searchResults = await webBatchSearch({
    queries: queryOwners.map((q) => q.query),
    concurrency: options.concurrency ?? 4,
    maxResultsPerQuery: 5,
    locale: options.locale,
    country: options.country,
  });
  const byRow = new Map<number, SourceCandidate[]>();
  searchResults.forEach((result, index) => {
    const owner = queryOwners[index];
    const candidates = result.results.map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      source: 'search' as const,
      confidence: Math.max(0.1, 0.7 - r.rank * 0.07),
      evidence: [r.snippet, r.title].filter((v): v is string => Boolean(v)),
    }));
    byRow.set(owner.rowIndex, [...(byRow.get(owner.rowIndex) ?? []), ...candidates]);
  });
  return items.map((item) => ({
    ...item,
    status: 'searching',
    attempts: item.attempts + 1,
    sources: dedupeCandidates(byRow.get(item.rowIndex) ?? []),
  }));
}

function dedupeCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
