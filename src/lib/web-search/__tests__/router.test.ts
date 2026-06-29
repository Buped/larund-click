import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelCapabilities, supportsNativeWebSearch } from '../capabilities';
import { evaluateSearchEvidence, isSearchEngineUrl } from '../quality';
import { buildGeminiGoogleSearchRequest, extractGeminiUrlCitations } from '../providers/gemini-google-search';
import { buildOpenAIWebSearchRequest, extractOpenAIUrlCitations } from '../providers/openai-web-search';

describe('model native web search capabilities', () => {
  it('marks direct OpenAI models as native web-search capable', () => {
    expect(supportsNativeWebSearch('openai', 'gpt-5.5')).toBe(true);
    expect(getModelCapabilities('openai', 'gpt-5.5').nativeWebSearchToolType).toBe('openai_web_search');
  });

  it('marks direct Gemini models as Google Search capable', () => {
    expect(supportsNativeWebSearch('gemini', 'gemini-3.1-flash-lite')).toBe(true);
    expect(getModelCapabilities('gemini', 'gemini-3.1-flash-lite').nativeWebSearchToolType).toBe('gemini_google_search');
  });

  it('does not treat OpenRouter Gemini as proven provider-native search forwarding', () => {
    expect(supportsNativeWebSearch('openrouter', 'google/gemini-3.1-flash-lite')).toBe(false);
  });
});

describe('web search router', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'your_openrouter_key_here');
    vi.stubEnv('VITE_BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('VITE_TAVILY_API_KEY', '');
    vi.stubEnv('VITE_EXA_API_KEY', '');
  });

  it('routes required web mode to provider native search when supported', async () => {
    const { routeWebSearch } = await import('../web-search-router');
    const route = routeWebSearch({
      userPrompt: 'latest Claude news',
      selectedModel: { provider: 'openai', modelId: 'gpt-5.5' },
      webMode: 'required',
      searchDepth: 'standard',
    });
    expect(route.strategy).toBe('provider_native_search');
    expect(route.mustNotUseBrowserOpenForSearch).toBe(true);
  });

  it('routes required OpenRouter Gemini web mode to server-side adapter when configured', async () => {
    vi.stubEnv('VITE_BRAVE_SEARCH_API_KEY', 'brave-test-key');
    const { routeWebSearch } = await import('../web-search-router');
    const route = routeWebSearch({
      userPrompt: 'Keresd ki az interneten a legfrissebb hireket',
      selectedModel: { provider: 'openrouter', modelId: 'google/gemini-3.1-flash-lite' },
      webMode: 'required',
      searchDepth: 'standard',
    });
    expect(route.strategy).toBe('server_side_search_adapter');
    expect(route.provider).toBe('openrouter');
  });

  it('blocks required web mode when neither native nor server-side search exists', async () => {
    const { routeWebSearch } = await import('../web-search-router');
    const route = routeWebSearch({
      userPrompt: 'Keresd ki az interneten a legfrissebb hireket',
      selectedModel: { provider: 'openrouter', modelId: 'google/gemini-3.1-flash-lite' },
      webMode: 'required',
      searchDepth: 'standard',
    });
    expect(route.strategy).toBe('blocked_missing_search_capability');
  });
});

describe('browser fallback and quality', () => {
  it('detects search engine URLs', () => {
    expect(isSearchEngineUrl('https://www.google.com/search?q=spacex')).toBe(true);
    expect(isSearchEngineUrl('https://duckduckgo.com/?q=spacex')).toBe(true);
    expect(isSearchEngineUrl('https://example.com/article')).toBe(false);
  });

  it('does not allow browser fallback evidence to be ok', () => {
    const evidence = evaluateSearchEvidence({
      mode: 'browser_fallback',
      provider: 'none',
      modelId: 'google/gemini-3.1-flash-lite',
      queries: ['SpaceX latest news'],
      sources: [],
      citations: [],
      usedBrowserOpen: true,
      usedSearchEnginePage: false,
      quality: 'ok',
      warnings: [],
    });
    expect(evidence.quality).toBe('failed');
  });
});

describe('native provider request builders', () => {
  it('builds OpenAI Responses web_search requests with required tool choice', () => {
    const body = buildOpenAIWebSearchRequest({
      userPrompt: 'latest SpaceX news',
      selectedModel: { provider: 'openai', modelId: 'gpt-5.5' },
      webMode: 'required',
      searchDepth: 'standard',
    });
    expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'medium' }]);
    expect(body.tool_choice).toBe('required');
  });

  it('builds Gemini requests with google_search tool', () => {
    const body = buildGeminiGoogleSearchRequest({
      userPrompt: 'latest Claude news',
      selectedModel: { provider: 'gemini', modelId: 'gemini-3.1-flash-lite' },
      webMode: 'required',
      searchDepth: 'quick',
    });
    expect(body.tools).toEqual([{ google_search: {} }]);
  });

  it('parses OpenAI and Gemini URL citations', () => {
    expect(extractOpenAIUrlCitations({ output: [{ content: [{ annotations: [{ type: 'url_citation', url: 'https://example.com', title: 'Example' }] }] }] })).toHaveLength(1);
    expect(extractGeminiUrlCitations({
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://example.com/gemini', title: 'Gemini source' } }],
          groundingSupports: [{ groundingChunkIndices: [0], segment: { startIndex: 1, endIndex: 9 } }],
        },
      }],
    })).toHaveLength(1);
  });
});
