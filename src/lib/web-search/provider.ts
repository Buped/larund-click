import { invoke } from '@tauri-apps/api/core';
import { normalizeSearchCitations } from '../search-citations';
import { cleanWebText } from '../text/encoding';
import type { ExtractedContactInfo, WebBatchSearchInput, WebSearchInput, WebSearchResult, WebSearchResultItem } from './types';

const OPENROUTER_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
const BRAVE_KEY = import.meta.env.VITE_BRAVE_SEARCH_API_KEY as string | undefined;
const TAVILY_KEY = import.meta.env.VITE_TAVILY_API_KEY as string | undefined;
const EXA_KEY = import.meta.env.VITE_EXA_API_KEY as string | undefined;

interface HttpResponse {
  status: number;
  body: string;
}

export function hasConfiguredServerSideSearch(): boolean {
  return Boolean(
    BRAVE_KEY ||
    TAVILY_KEY ||
    EXA_KEY ||
    (OPENROUTER_KEY && OPENROUTER_KEY !== 'your_openrouter_key_here'),
  );
}

function cleanResults(raw: WebSearchResultItem[], bannedDomains: string[] = []): WebSearchResultItem[] {
  const banned = bannedDomains.map((d) => d.toLowerCase().replace(/^www\./, ''));
  const seen = new Set<string>();
  return raw
    .filter((item) => {
      try {
        const host = new URL(item.url).hostname.replace(/^www\./, '').toLowerCase();
        return !banned.some((domain) => host === domain || host.endsWith(`.${domain}`));
      } catch {
        return false;
      }
    })
    .filter((item) => {
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, Math.max(1, raw.length || 5));
}

async function httpJson(method: string, url: string, headers?: Record<string, string>, body?: unknown): Promise<unknown> {
  const res = await invoke<HttpResponse>('http_request', {
    method,
    url,
    headers: headers ?? null,
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`http_${res.status}: ${res.body.slice(0, 300)}`);
  }
  return JSON.parse(res.body);
}

function item(title: unknown, url: unknown, snippet: unknown, rank: number, source?: string): WebSearchResultItem | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  return {
    title: cleanWebText(title) ?? url,
    url,
    snippet: cleanWebText(snippet),
    source,
    rank,
  };
}

async function braveSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!BRAVE_KEY) throw new Error('brave_not_configured');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', input.query);
  url.searchParams.set('count', String(input.maxResults ?? 5));
  if (input.country) url.searchParams.set('country', input.country);
  const parsed = await httpJson('GET', url.toString(), {
    'Accept': 'application/json',
    'X-Subscription-Token': BRAVE_KEY,
  }) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const raw = (parsed.web?.results ?? [])
    .map((r, i) => item(r.title, r.url, r.description, i + 1, 'brave'))
    .filter((r): r is WebSearchResultItem => Boolean(r));
  return {
    query: input.query,
    results: cleanResults(raw, input.bannedDomains).slice(0, input.maxResults ?? 5),
    provider: 'brave',
    searchedAt: new Date().toISOString(),
  };
}

async function tavilySearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!TAVILY_KEY) throw new Error('tavily_not_configured');
  const parsed = await httpJson('POST', 'https://api.tavily.com/search', {
    'Content-Type': 'application/json',
  }, {
    api_key: TAVILY_KEY,
    query: input.query,
    search_depth: input.depth === 'standard' ? 'advanced' : 'basic',
    max_results: input.maxResults ?? 5,
  }) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const raw = (parsed.results ?? [])
    .map((r, i) => item(r.title, r.url, r.content, i + 1, 'tavily'))
    .filter((r): r is WebSearchResultItem => Boolean(r));
  return {
    query: input.query,
    results: cleanResults(raw, input.bannedDomains).slice(0, input.maxResults ?? 5),
    provider: 'tavily',
    searchedAt: new Date().toISOString(),
  };
}

async function exaSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!EXA_KEY) throw new Error('exa_not_configured');
  const parsed = await httpJson('POST', 'https://api.exa.ai/search', {
    'Content-Type': 'application/json',
    'x-api-key': EXA_KEY,
  }, {
    query: input.query,
    numResults: input.maxResults ?? 5,
  }) as { results?: Array<{ title?: string; url?: string; text?: string }> };
  const raw = (parsed.results ?? [])
    .map((r, i) => item(r.title, r.url, r.text, i + 1, 'exa'))
    .filter((r): r is WebSearchResultItem => Boolean(r));
  return {
    query: input.query,
    results: cleanResults(raw, input.bannedDomains).slice(0, input.maxResults ?? 5),
    provider: 'exa',
    searchedAt: new Date().toISOString(),
  };
}

async function openRouterSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'your_openrouter_key_here') {
    throw new Error('openrouter_not_configured');
  }
  const body = {
    model: 'openai/gpt-4.1-mini',
    messages: [
      { role: 'system', content: 'Use web search and return a compact list of relevant source URLs. No prose.' },
      { role: 'user', content: input.query },
    ],
    stream: false,
    tools: [{
      type: 'openrouter:web_search',
      parameters: {
        engine: 'auto',
        search_context_size: input.depth === 'standard' ? 'medium' : 'low',
        max_results: input.maxResults ?? 5,
        max_total_results: input.maxResults ?? 5,
      },
    }],
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://larund.io',
      'X-Title': 'Larund Click',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openrouter_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parsed = await res.json();
  const annotations = parsed.choices?.[0]?.message?.annotations ?? parsed.annotations ?? [];
  const citations = normalizeSearchCitations(Array.isArray(annotations) ? annotations : []);
  const raw = citations.map((c, i) => item(c.title, c.url, c.snippet, i + 1, 'openrouter_web_search')).filter((r): r is WebSearchResultItem => Boolean(r));
  return {
    query: input.query,
    results: cleanResults(raw, input.bannedDomains).slice(0, input.maxResults ?? 5),
    provider: 'openrouter_web_search',
    searchedAt: new Date().toISOString(),
  };
}

export async function webSearch(input: WebSearchInput): Promise<WebSearchResult> {
  const errors: string[] = [];
  for (const provider of [braveSearch, tavilySearch, exaSearch, openRouterSearch]) {
    try {
      const result = await provider(input);
      if (result.results.length > 0) return result;
      errors.push(`${result.provider}: empty_results`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`web_search_unavailable: ${errors.join(' | ')}`);
}

export async function webBatchSearch(input: WebBatchSearchInput): Promise<WebSearchResult[]> {
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 4, 8));
  const queries = input.queries.map((q) => q.trim()).filter(Boolean);
  const results: WebSearchResult[] = [];
  let next = 0;
  async function worker() {
    while (next < queries.length) {
      const index = next++;
      results[index] = await webSearch({
        query: queries[index],
        maxResults: input.maxResultsPerQuery ?? 5,
        locale: input.locale,
        country: input.country,
        depth: 'quick',
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, worker));
  return results;
}

export async function extractPage(url: string, maxChars = 12_000): Promise<{ url: string; title?: string; text: string }> {
  const res = await invoke<HttpResponse>('http_request', {
    method: 'GET',
    url,
    headers: { 'User-Agent': 'LarundClick/1.0' },
    body: null,
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`http_${res.status}`);
  const title = cleanWebText(res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const text = res.body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
  return { url, title, text: cleanWebText(text) ?? text };
}

export function extractContactInfo(url: string, content: string): ExtractedContactInfo {
  const emails = [...new Set((content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((v) => v.toLowerCase()))];
  const phones = [...new Set((content.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? []).map((v) => v.replace(/\s+/g, ' ').trim()))];
  const links = {
    linkedin: content.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[^\s"'<>]+/i)?.[0],
    contact: content.match(/https?:\/\/[^\s"'<>]*(?:contact|kapcsolat)[^\s"'<>]*/i)?.[0],
    website: url,
  };
  return { url, emails, phones, links };
}
