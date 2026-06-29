import type { RecentAction } from '../agent-state/types';

export interface SearchEvidence {
  mode: 'provider_native' | 'server_side' | 'browser_fallback';
  provider: string;
  modelId: string;
  queries: string[];
  sources: Array<{
    title: string;
    url: string;
    domain: string;
    snippet?: string;
    publishedAt?: string;
    cited: boolean;
  }>;
  citations: Array<{
    sourceUrl: string;
    title: string;
    startIndex?: number;
    endIndex?: number;
  }>;
  usedBrowserOpen: boolean;
  usedSearchEnginePage: boolean;
  quality: 'ok' | 'partial' | 'failed';
  warnings: string[];
}

export function isSearchEngineUrl(url: string): boolean {
  return /(?:google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com\/(?:\?|html)|search\.yahoo\.com\/search)/i.test(url);
}

export function isExplicitWebLookup(text: string): boolean {
  return /\b(keresd ki|keress|n[eé]zz ut[aá]na|interneten|legfrissebb|friss h[ií]r|current|latest|news|look up|search the web|find on the internet)\b/i.test(text);
}

export function evidenceFromRecentActions(recent: RecentAction[], modelId = 'unknown'): SearchEvidence {
  const webSearchActions = recent.filter((a) => a.success && (a.action === 'web.search' || a.action === 'web.batch_search'));
  const browserOpenActions = recent.filter((a) => a.success && a.action === 'browser.open');
  const sources = webSearchActions.flatMap((action) => sourcesFromOutput(action.output));
  const queries = webSearchActions.flatMap((action) => queriesFromOutput(action.output, action.argsSummary));
  const usedSearchEnginePage = browserOpenActions.some((action) => isSearchEngineUrl(`${action.argsSummary ?? ''}\n${action.output ?? ''}`));
  const evidence: SearchEvidence = {
    mode: webSearchActions.length ? 'server_side' : browserOpenActions.length ? 'browser_fallback' : 'browser_fallback',
    provider: providerFromOutput(webSearchActions[0]?.output) ?? (webSearchActions.length ? 'custom' : 'none'),
    modelId,
    queries,
    sources,
    citations: [],
    usedBrowserOpen: browserOpenActions.length > 0,
    usedSearchEnginePage,
    quality: 'failed',
    warnings: [],
  };
  return evaluateSearchEvidence(evidence);
}

export function evaluateSearchEvidence(evidence: SearchEvidence): SearchEvidence {
  const warnings = [...evidence.warnings];
  if (evidence.mode === 'browser_fallback') warnings.push('Only browser fallback was used.');
  if (evidence.usedSearchEnginePage) warnings.push('A search engine result page was opened in the browser.');
  if (evidence.sources.length === 0) warnings.push('No clickable search sources were captured.');
  if (evidence.mode !== 'provider_native' && evidence.mode !== 'server_side') {
    return { ...evidence, quality: 'failed', warnings: unique(warnings) };
  }
  if (evidence.usedSearchEnginePage) {
    return { ...evidence, quality: 'failed', warnings: unique(warnings) };
  }
  if (evidence.sources.length === 0) {
    return { ...evidence, quality: 'failed', warnings: unique(warnings) };
  }
  if (evidence.citations.length === 0 && !evidence.sources.some((source) => source.cited)) {
    warnings.push('Sources exist, but no citation mapping was captured.');
    return { ...evidence, quality: 'partial', warnings: unique(warnings) };
  }
  return { ...evidence, quality: warnings.length ? 'partial' : 'ok', warnings: unique(warnings) };
}

function sourcesFromOutput(output?: string): SearchEvidence['sources'] {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    const runs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) && parsed.query ? [parsed] : Array.isArray(parsed.results) ? parsed.results : [];
    return runs.flatMap((run: any) => {
      const results = Array.isArray(run.results) ? run.results : [];
      return results
        .filter((item: any) => typeof item?.url === 'string')
        .map((item: any) => ({
          title: typeof item.title === 'string' ? item.title : item.url,
          url: item.url,
          domain: domainFromUrl(item.url),
          snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
          publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : undefined,
          cited: true,
        }));
    });
  } catch {
    return [];
  }
}

function queriesFromOutput(output?: string, argsSummary?: string): string[] {
  const queries = new Set<string>();
  try {
    const args = argsSummary ? JSON.parse(argsSummary) : undefined;
    if (typeof args?.query === 'string') queries.add(args.query);
    if (Array.isArray(args?.queries)) args.queries.filter((q: unknown): q is string => typeof q === 'string').forEach((q: string) => queries.add(q));
  } catch {
    // ignore non-JSON summaries
  }
  try {
    const parsed = output ? JSON.parse(output) : undefined;
    if (typeof parsed?.query === 'string') queries.add(parsed.query);
    if (Array.isArray(parsed?.results)) {
      parsed.results.forEach((item: any) => {
        if (typeof item?.query === 'string') queries.add(item.query);
      });
    }
  } catch {
    // ignore plain output
  }
  return [...queries];
}

function providerFromOutput(output?: string): string | undefined {
  try {
    const parsed = output ? JSON.parse(output) : undefined;
    if (typeof parsed?.provider === 'string') return parsed.provider;
    if (Array.isArray(parsed?.results) && typeof parsed.results[0]?.provider === 'string') return parsed.results[0].provider;
  } catch {
    return undefined;
  }
  return undefined;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
