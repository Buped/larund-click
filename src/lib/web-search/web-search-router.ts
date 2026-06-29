import { getModelCapabilities, providerFromModelId } from './capabilities';
import { hasConfiguredServerSideSearch } from './provider';

export interface WebSearchRequest {
  userPrompt: string;
  conversationId?: string;
  selectedModel: {
    provider: string;
    modelId: string;
    displayName?: string;
  };
  webMode: 'off' | 'auto' | 'required';
  searchDepth: 'quick' | 'standard' | 'extended';
  requireFreshness?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  locale?: string;
  country?: string;
}

export interface WebSearchRouteDecision {
  strategy:
    | 'provider_native_search'
    | 'server_side_search_adapter'
    | 'browser_read_specific_url'
    | 'blocked_missing_search_capability';
  provider: 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'brave' | 'custom' | 'none';
  modelId?: string;
  reason: string;
  mustNotUseBrowserOpenForSearch: boolean;
  nativeSearchSupported?: boolean;
  providerRequestHadSearchTool?: boolean;
  serverSideSearchAvailable?: boolean;
}

const URL_ONLY_RE = /^\s*(?:olvasd el|read|summarize|summarise|open)\s+(?:ezt\s+az\s+oldalt:?\s*)?https?:\/\/\S+\s*$/i;

export function explicitWebRequested(prompt: string): boolean {
  return /\b(keresd ki|keress|n[eé]zz ut[aá]na|interneten|legfrissebb|friss h[ií]r|current|latest|news|look up|search the web|find on the internet)\b/i.test(prompt);
}

export function routeWebSearch(request: WebSearchRequest): WebSearchRouteDecision {
  const inferredProvider = request.selectedModel.provider || providerFromModelId(request.selectedModel.modelId);
  const provider = normalizeProvider(inferredProvider);
  const capabilities = getModelCapabilities(inferredProvider, request.selectedModel.modelId);
  const serverSideSearchAvailable = hasConfiguredServerSideSearch();
  const wantsWeb = request.webMode === 'required' || (request.webMode === 'auto' && explicitWebRequested(request.userPrompt));

  if (request.webMode === 'off') {
    return {
      strategy: URL_ONLY_RE.test(request.userPrompt) ? 'browser_read_specific_url' : 'blocked_missing_search_capability',
      provider: 'none',
      modelId: request.selectedModel.modelId,
      reason: 'Web mode is off.',
      mustNotUseBrowserOpenForSearch: true,
      nativeSearchSupported: false,
      serverSideSearchAvailable,
    };
  }

  if (!wantsWeb && URL_ONLY_RE.test(request.userPrompt)) {
    return {
      strategy: 'browser_read_specific_url',
      provider,
      modelId: request.selectedModel.modelId,
      reason: 'The prompt names a specific URL to read, not a general search task.',
      mustNotUseBrowserOpenForSearch: false,
      nativeSearchSupported: capabilities.supportsNativeWebSearch,
      serverSideSearchAvailable,
    };
  }

  if (capabilities.supportsNativeWebSearch) {
    return {
      strategy: 'provider_native_search',
      provider,
      modelId: request.selectedModel.modelId,
      reason: `${inferredProvider} supports native web search for ${request.selectedModel.modelId}.`,
      mustNotUseBrowserOpenForSearch: true,
      nativeSearchSupported: true,
      providerRequestHadSearchTool: true,
      serverSideSearchAvailable,
    };
  }

  if (serverSideSearchAvailable) {
    return {
      strategy: 'server_side_search_adapter',
      provider: provider === 'openrouter' ? 'openrouter' : 'custom',
      modelId: request.selectedModel.modelId,
      reason: `${inferredProvider}/${request.selectedModel.modelId} has no proven native search forwarding, so Larund must use a server-side search adapter.`,
      mustNotUseBrowserOpenForSearch: true,
      nativeSearchSupported: false,
      providerRequestHadSearchTool: false,
      serverSideSearchAvailable,
    };
  }

  return {
    strategy: 'blocked_missing_search_capability',
    provider: 'none',
    modelId: request.selectedModel.modelId,
    reason: 'No native web search capability and no configured server-side search adapter are available.',
    mustNotUseBrowserOpenForSearch: true,
    nativeSearchSupported: false,
    providerRequestHadSearchTool: false,
    serverSideSearchAvailable: false,
  };
}

function normalizeProvider(provider: string): WebSearchRouteDecision['provider'] {
  const p = provider.toLowerCase();
  if (p === 'google') return 'gemini';
  if (p === 'openai' || p === 'gemini' || p === 'anthropic' || p === 'openrouter' || p === 'brave') return p;
  return 'custom';
}
