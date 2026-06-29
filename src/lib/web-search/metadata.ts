import { domainFromUrl, type SearchCitation, type SearchMode } from '../search-citations';
import type { AgentStep } from '../agent-loop';
import { cleanWebText } from '../text/encoding';
import type { WebSearchResult, WebSearchResultItem } from './types';

export type WebSearchDepth = 'quick' | 'standard' | 'deep';
export type WebSearchProvider =
  | 'openai_web_search'
  | 'openrouter_web_search'
  | 'brave'
  | 'tavily'
  | 'exa'
  | 'custom';

export type WebSourceKind = 'search_result' | 'opened_page' | 'citation';

export interface WebSearchRun {
  id: string;
  query: string;
  provider: WebSearchProvider;
  mode: WebSearchDepth;
  requestedMaxResults?: number;
  returnedResults: number;
  searchedAt: string;
}

export interface WebOpenedPage {
  url: string;
  title?: string;
  openedAt: string;
  extractor?: 'http' | 'browser' | 'api' | 'unknown';
  textChars?: number;
}

export interface WebSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  snippet?: string;
  rank?: number;
  provider?: WebSearchProvider;
  query?: string;
  kind: WebSourceKind;
  retrievedAt: string;
  openedAt?: string;
  credibility: 'primary' | 'reference' | 'secondary' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export interface WebCitation {
  id: string;
  sourceId: string;
  sequenceNumber: number;
  startIndex?: number;
  endIndex?: number;
  quote?: string;
}

export interface WebAnswerQualityCheck {
  ok: boolean;
  reasons: string[];
  sourceCount: number;
  citationCount: number;
  hasEnoughDetail: boolean;
  hasDatesOrFreshness: boolean;
}

export interface AnswerModelMetadata {
  provider: 'openrouter' | 'openai' | 'anthropic' | 'google' | 'local' | 'unknown';
  modelId: string;
  displayName: string;
  tier?: 'fast' | 'balanced' | 'power' | 'deep_research' | 'unknown';
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  searchCostUsd?: number;
  latencyMs?: number;
  generatedAt: string;
  toolsUsed: string[];
  webSearchMode?: SearchMode;
  searchStrategy?: 'provider_native_search' | 'server_side_search_adapter' | 'browser_read_specific_url' | 'blocked_missing_search_capability';
  searchProvider?: string;
  searchWarnings?: string[];
  webSearchRunsCount?: number;
  webSourcesCount?: number;
  quality?: WebAnswerQualityCheck;
}

type ParsedAgentWebSearch = WebSearchResult & { provider: WebSearchProvider };

export function parseJsonArray<T>(raw?: string | null, guard?: (item: unknown) => item is T): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return guard ? parsed.filter(guard) : parsed as T[];
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(raw?: string | null, guard?: (item: unknown) => item is T): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return guard && !guard(parsed) ? undefined : parsed as T;
  } catch {
    return undefined;
  }
}

export function isWebSource(item: unknown): item is WebSource {
  return Boolean(item && typeof item === 'object' && typeof (item as WebSource).url === 'string');
}

export function isWebCitation(item: unknown): item is WebCitation {
  return Boolean(item && typeof item === 'object' && typeof (item as WebCitation).sourceId === 'string');
}

export function isWebSearchRun(item: unknown): item is WebSearchRun {
  return Boolean(item && typeof item === 'object' && typeof (item as WebSearchRun).query === 'string');
}

export function isAnswerModelMetadata(item: unknown): item is AnswerModelMetadata {
  return Boolean(item && typeof item === 'object' && typeof (item as AnswerModelMetadata).modelId === 'string');
}

export function stableSourceId(url: string): string {
  return `src-${Math.abs(hashString(url.toLowerCase())).toString(36)}`;
}

export function classifyCredibility(url: string): WebSource['credibility'] {
  const host = domainFromUrl(url).toLowerCase();
  if (/\.(gov|edu)(?:\.|$)/.test(host) || host.endsWith('.europa.eu')) return 'primary';
  if (/(?:docs|developer|help|support)\./.test(host) || /(?:github\.com|ietf\.org|w3\.org|openai\.com|microsoft\.com|apple\.com|google\.com)$/.test(host)) {
    return 'reference';
  }
  if (/(?:reuters|apnews|bbc|ft\.com|bloomberg|wsj|nytimes|theguardian|nature\.com|science\.org)/.test(host)) return 'secondary';
  return 'unknown';
}

function confidenceFor(source: Pick<WebSource, 'credibility' | 'snippet' | 'kind'>): WebSource['confidence'] {
  if (source.credibility === 'primary' || source.credibility === 'reference') return 'high';
  if (source.kind === 'opened_page' || source.snippet) return 'medium';
  return 'low';
}

function sourceFromResult(result: WebSearchResultItem, run: ParsedAgentWebSearch): WebSource {
  const credibility = classifyCredibility(result.url);
  return {
    id: stableSourceId(result.url),
    url: result.url,
    title: cleanWebText(result.title) || domainFromUrl(result.url),
    domain: domainFromUrl(result.url),
    snippet: cleanWebText(result.snippet),
    rank: result.rank,
    provider: run.provider,
    query: run.query,
    kind: 'search_result',
    retrievedAt: run.searchedAt,
    credibility,
    confidence: confidenceFor({ credibility, snippet: result.snippet, kind: 'search_result' }),
  };
}

export function sourcesFromSearchCitations(citations: SearchCitation[]): WebSource[] {
  return dedupeSources(citations.map((citation) => {
    const credibility = classifyCredibility(citation.url);
    return {
      id: stableSourceId(citation.url),
      url: citation.url,
      title: cleanWebText(citation.title) || domainFromUrl(citation.url),
      domain: citation.domain || domainFromUrl(citation.url),
      snippet: cleanWebText(citation.snippet),
      rank: citation.sequence_number,
      provider: 'openrouter_web_search' as const,
      kind: 'citation' as const,
      retrievedAt: citation.retrieved_at,
      credibility,
      confidence: confidenceFor({ credibility, snippet: citation.snippet, kind: 'citation' }),
    };
  }));
}

export function citationsToWebCitations(citations: SearchCitation[], sources: WebSource[]): WebCitation[] {
  return citations.map((citation) => ({
    id: citation.citation_id,
    sourceId: sources.find((source) => source.url === citation.url)?.id ?? stableSourceId(citation.url),
    sequenceNumber: citation.sequence_number,
    startIndex: citation.start_index,
    endIndex: citation.end_index,
  }));
}

export function searchRunFromChat(messageId: string, query: string, mode: SearchMode, sourceCount: number): WebSearchRun | undefined {
  if (mode === 'none') return undefined;
  return {
    id: `search-${messageId}`,
    query,
    provider: 'openrouter_web_search',
    mode: mode === 'fast' ? 'quick' : 'deep',
    requestedMaxResults: mode === 'deep' ? 10 : 5,
    returnedResults: sourceCount,
    searchedAt: new Date().toISOString(),
  };
}

export function webMetadataFromAgentSteps(steps: AgentStep[]): { runs: WebSearchRun[]; sources: WebSource[]; openedPages: WebOpenedPage[]; toolsUsed: string[] } {
  const runs: WebSearchRun[] = [];
  const sources: WebSource[] = [];
  const openedPages: WebOpenedPage[] = [];
  const toolsUsed = Array.from(new Set(steps.map((step) => step.tool).filter((tool): tool is string => Boolean(tool))));

  for (const step of steps) {
    if (step.type !== 'tool_result') continue;
    if (step.tool === 'web.search') {
      const run = parseAgentWebSearch(step.details?.webSearch, step.output);
      if (!run) continue;
      runs.push({
        id: `search-${step.id}`,
        query: run.query,
        provider: run.provider,
        mode: 'quick',
        returnedResults: run.results.length,
        searchedAt: run.searchedAt,
      });
      sources.push(...run.results.map((result) => sourceFromResult(result, run)));
    } else if (step.tool === 'web.batch_search') {
      const batch = parseAgentWebBatch(step.details?.webBatchSearch, step.output);
      for (const run of batch) {
        runs.push({
          id: `search-${step.id}-${runs.length + 1}`,
          query: run.query,
          provider: run.provider,
          mode: 'quick',
          returnedResults: run.results.length,
          searchedAt: run.searchedAt,
        });
        sources.push(...run.results.map((result) => sourceFromResult(result, run)));
      }
    } else if (step.tool === 'web.extract_page') {
      const page = parseExtractedPage(step.details?.extractedPage, step.output);
      if (!page?.url) continue;
      const openedAt = step.timestamp || new Date().toISOString();
      openedPages.push({
        url: page.url,
        title: page.title,
        openedAt,
        extractor: 'http',
        textChars: page.text?.length,
      });
      const credibility = classifyCredibility(page.url);
      sources.push({
        id: stableSourceId(page.url),
        url: page.url,
        title: cleanWebText(page.title) || domainFromUrl(page.url),
        domain: domainFromUrl(page.url),
        snippet: cleanWebText(page.text?.slice(0, 260)),
        kind: 'opened_page',
        retrievedAt: openedAt,
        openedAt,
        credibility,
        confidence: confidenceFor({ credibility, snippet: page.text, kind: 'opened_page' }),
      });
    }
  }

  return { runs, sources: dedupeSources(sources), openedPages, toolsUsed };
}

export function buildAnswerModelMetadata(input: {
  provider?: AnswerModelMetadata['provider'];
  modelId: string;
  displayName?: string;
  tier?: AnswerModelMetadata['tier'];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  searchCostUsd?: number;
  latencyMs?: number;
  toolsUsed?: string[];
  webSearchMode?: SearchMode;
  searchStrategy?: AnswerModelMetadata['searchStrategy'];
  searchProvider?: string;
  searchWarnings?: string[];
  webSearchRunsCount?: number;
  webSourcesCount?: number;
  quality?: WebAnswerQualityCheck;
}): AnswerModelMetadata {
  return {
    provider: input.provider ?? inferProvider(input.modelId),
    modelId: input.modelId,
    displayName: input.displayName ?? input.modelId,
    tier: input.tier ?? 'unknown',
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd,
    searchCostUsd: input.searchCostUsd,
    latencyMs: input.latencyMs,
    generatedAt: new Date().toISOString(),
    toolsUsed: input.toolsUsed ?? [],
    webSearchMode: input.webSearchMode,
    searchStrategy: input.searchStrategy,
    searchProvider: input.searchProvider,
    searchWarnings: input.searchWarnings,
    webSearchRunsCount: input.webSearchRunsCount,
    webSourcesCount: input.webSourcesCount,
    quality: input.quality,
  };
}

export function verifyWebAnswerQuality(markdown: string, sources: WebSource[], metadata?: Partial<AnswerModelMetadata>): WebAnswerQualityCheck {
  const citationCount = (markdown.match(/\[\^\d+\]/g) ?? []).length;
  const hasEnoughDetail = markdown.trim().split(/\s+/).length >= 90 || /\n\s*[-*]\s/.test(markdown) || /^#{2,3}\s/m.test(markdown);
  const hasDatesOrFreshness = /\b(?:20\d{2}|today|current|latest|updated|as of|ma|mai|jelenleg|friss|legfrissebb)\b/i.test(markdown);
  const needsSources = (metadata?.webSearchMode ?? 'none') !== 'none' || sources.length > 0;
  const reasons: string[] = [];
  if (needsSources && sources.length === 0) reasons.push('No web sources are attached.');
  if (needsSources && citationCount === 0) reasons.push('No inline source markers are present.');
  if (needsSources && !hasEnoughDetail) reasons.push('The answer looks too thin for a web-backed response.');
  if (needsSources && !hasDatesOrFreshness) reasons.push('The answer does not state dates or freshness context.');
  return {
    ok: reasons.length === 0,
    reasons,
    sourceCount: sources.length,
    citationCount,
    hasEnoughDetail,
    hasDatesOrFreshness,
  };
}

function parseAgentWebSearch(details: unknown, output?: string): ParsedAgentWebSearch | undefined {
  const parsed = details ?? parseUnknownJson(output);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const value = parsed as Partial<WebSearchResult>;
  if (typeof value.query !== 'string' || !Array.isArray(value.results)) return undefined;
  return {
    query: value.query,
    results: value.results.filter(isWebSearchResultItem),
    provider: normalizeProvider(value.provider),
    searchedAt: typeof value.searchedAt === 'string' ? value.searchedAt : new Date().toISOString(),
  };
}

function parseAgentWebBatch(details: unknown, output?: string): ParsedAgentWebSearch[] {
  const parsed = details ?? parseUnknownJson(output);
  if (Array.isArray(parsed)) return parsed.map((item) => parseAgentWebSearch(item)).filter((item): item is ParsedAgentWebSearch => Boolean(item));
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)) {
    return (parsed as { results: unknown[] }).results.map((item) => parseAgentWebSearch(item)).filter((item): item is ParsedAgentWebSearch => Boolean(item));
  }
  return [];
}

function parseExtractedPage(details: unknown, output?: string): { url?: string; title?: string; text?: string } | undefined {
  const parsed = details ?? parseUnknownJson(output);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const page = parsed as { url?: unknown; title?: unknown; text?: unknown };
  return {
    url: typeof page.url === 'string' ? page.url : undefined,
    title: typeof page.title === 'string' ? page.title : undefined,
    text: typeof page.text === 'string' ? page.text : undefined,
  };
}

function isWebSearchResultItem(item: unknown): item is WebSearchResultItem {
  return Boolean(item && typeof item === 'object' && typeof (item as WebSearchResultItem).url === 'string');
}

function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Map<string, WebSource>();
  for (const source of sources) {
    const key = source.url.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, source);
      continue;
    }
    seen.set(key, {
      ...existing,
      ...source,
      snippet: existing.snippet ?? source.snippet,
      rank: existing.rank ?? source.rank,
      openedAt: existing.openedAt ?? source.openedAt,
      kind: existing.kind === 'opened_page' ? existing.kind : source.kind,
      confidence: existing.confidence === 'high' ? existing.confidence : source.confidence,
    });
  }
  return Array.from(seen.values()).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}

function inferProvider(modelId: string): AnswerModelMetadata['provider'] {
  if (modelId.startsWith('openai/')) return 'openai';
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('google/')) return 'google';
  if (modelId.includes('/')) return 'openrouter';
  return 'unknown';
}

function normalizeProvider(provider: unknown): WebSearchProvider {
  const p = typeof provider === 'string' ? provider : '';
  if (['openai_web_search', 'openrouter_web_search', 'brave', 'tavily', 'exa', 'custom'].includes(p)) {
    return p as WebSearchProvider;
  }
  return 'custom';
}

function parseUnknownJson(raw?: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
