export type SearchMode = 'none' | 'fast' | 'deep';
export type WebSearchPreference = 'auto' | 'always' | 'never';
export type SearchContextSize = 'low' | 'medium' | 'high';

export interface SearchCitation {
  citation_id: string;
  message_id?: string;
  sequence_number: number;
  url: string;
  title: string;
  domain: string;
  snippet?: string;
  start_index?: number;
  end_index?: number;
  retrieved_at: string;
}

export interface RawUrlCitation {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  snippet?: unknown;
  start_index?: unknown;
  end_index?: unknown;
}

export interface RawAnnotation {
  type?: unknown;
  url_citation?: RawUrlCitation;
}

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

function normalizeIndex(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function normalizeSearchCitations(raw: unknown[], messageId?: string): SearchCitation[] {
  const seen = new Map<string, SearchCitation>();
  const now = new Date().toISOString();

  for (const item of raw) {
    const annotation = item as RawAnnotation;
    if (annotation?.type !== 'url_citation' || !annotation.url_citation) continue;
    const uc = annotation.url_citation;
    const url = typeof uc.url === 'string' ? uc.url.trim() : '';
    if (!url) continue;
    const key = url.toLowerCase();
    const existing = seen.get(key);
    const title = typeof uc.title === 'string' && uc.title.trim()
      ? uc.title.trim()
      : domainFromUrl(url);
    const snippet = typeof uc.content === 'string' && uc.content.trim()
      ? uc.content.trim()
      : typeof uc.snippet === 'string' && uc.snippet.trim()
        ? uc.snippet.trim()
        : undefined;
    const start = normalizeIndex(uc.start_index);
    const end = normalizeIndex(uc.end_index);

    if (existing) {
      if (!existing.snippet && snippet) existing.snippet = snippet;
      if (existing.start_index === undefined && start !== undefined) existing.start_index = start;
      if (existing.end_index === undefined && end !== undefined) existing.end_index = end;
      continue;
    }

    const sequence = seen.size + 1;
    seen.set(key, {
      citation_id: `cite-${sequence}-${Math.abs(hashString(url)).toString(36)}`,
      message_id: messageId,
      sequence_number: sequence,
      url,
      title,
      domain: domainFromUrl(url),
      snippet,
      start_index: start,
      end_index: end,
      retrieved_at: now,
    });
  }

  return Array.from(seen.values());
}

export function parseSearchCitations(raw?: string | null): SearchCitation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SearchCitation => (
      item && typeof item === 'object' &&
      typeof item.url === 'string' &&
      typeof item.sequence_number === 'number'
    ));
  } catch {
    return [];
  }
}

export function injectCitationMarkers(content: string, citations: SearchCitation[]): string {
  const withOffsets = citations
    .filter((c) => c.end_index !== undefined && c.end_index >= 0 && c.end_index <= content.length)
    .sort((a, b) => (b.end_index ?? 0) - (a.end_index ?? 0));
  if (withOffsets.length === 0) return content;

  let out = content;
  const insertedAt = new Set<number>();
  for (const citation of withOffsets) {
    const end = citation.end_index!;
    if (insertedAt.has(end)) continue;
    insertedAt.add(end);
    out = `${out.slice(0, end)}[^${citation.sequence_number}]${out.slice(end)}`;
  }
  return out;
}

export function shouldUseWebSearch(text: string): boolean {
  const q = text.toLowerCase();
  if (/^\s*(?:mi|mennyi|what\s+is)?\s*\d+[\s+\-*/x×]\d+/.test(q)) return false;
  return [
    'today', 'latest', 'current', 'currently', 'now', 'news', 'breaking',
    'price', 'stock', 'exchange rate', 'weather', 'forecast', 'schedule',
    'ma ', 'mai', 'jelenleg', 'legfrissebb', 'friss', 'hirek', 'hírek',
    'arfolyam', 'árfolyam', 'idojaras', 'időjárás', 'most', 'tegnap',
    '2025', '2026',
  ].some((needle) => q.includes(needle));
}

export function rememberSearchCitations(userId: string, citations: SearchCitation[]): void {
  if (!userId || citations.length === 0 || typeof localStorage === 'undefined') return;
  const key = recentSearchSourcesKey(userId);
  const existing = listRecentSearchCitations(userId);
  const merged = [...citations, ...existing]
    .filter((item, index, arr) => arr.findIndex((x) => x.url === item.url) === index)
    .slice(0, 30);
  localStorage.setItem(key, JSON.stringify(merged));
}

export function listRecentSearchCitations(userId: string): SearchCitation[] {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(recentSearchSourcesKey(userId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SearchCitation => (
      item && typeof item === 'object' &&
      typeof item.url === 'string' &&
      typeof item.title === 'string'
    ));
  } catch {
    return [];
  }
}

function recentSearchSourcesKey(userId: string): string {
  return `larund_recent_search_sources:${userId}`;
}

export function isDeepResearchRequest(text: string): boolean {
  const q = text.toLowerCase();
  return [
    'deep research', 'research deeply', 'look into this deeply',
    'kutasd fel', 'melykutatas', 'mélykutatás', 'melyrehato', 'mélyreható',
    'alaposan nezz utana', 'alaposan nézz utána',
  ].some((needle) => q.includes(needle));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
