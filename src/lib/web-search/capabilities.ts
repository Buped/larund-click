export type NativeWebSearchToolType =
  | 'openai_web_search'
  | 'gemini_google_search'
  | 'anthropic_web_search';

export interface ModelCapabilities {
  provider: string;
  modelId: string;
  supportsNativeWebSearch: boolean;
  nativeWebSearchToolType?: NativeWebSearchToolType;
  supportsUrlCitations: boolean;
  supportsSourcesList: boolean;
  supportsToolChoiceRequired: boolean;
  supportsSearchContextSize?: boolean;
}

export function providerFromModelId(modelId: string): string {
  if (modelId.startsWith('openai/')) return 'openrouter';
  if (modelId.startsWith('google/') || modelId.startsWith('gemini/')) return 'openrouter';
  if (modelId.startsWith('anthropic/')) return 'openrouter';
  return 'unknown';
}

export function getModelCapabilities(provider: string, modelId: string): ModelCapabilities {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = modelId.toLowerCase();

  if (normalizedProvider === 'openai') {
    return {
      provider,
      modelId,
      supportsNativeWebSearch: true,
      nativeWebSearchToolType: 'openai_web_search',
      supportsUrlCitations: true,
      supportsSourcesList: true,
      supportsToolChoiceRequired: true,
      supportsSearchContextSize: true,
    };
  }

  if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
    const supportsGoogleSearch = normalizedModel.includes('gemini');
    return {
      provider,
      modelId,
      supportsNativeWebSearch: supportsGoogleSearch,
      nativeWebSearchToolType: supportsGoogleSearch ? 'gemini_google_search' : undefined,
      supportsUrlCitations: supportsGoogleSearch,
      supportsSourcesList: supportsGoogleSearch,
      supportsToolChoiceRequired: false,
      supportsSearchContextSize: false,
    };
  }

  if (normalizedProvider === 'anthropic') {
    return {
      provider,
      modelId,
      supportsNativeWebSearch: false,
      supportsUrlCitations: false,
      supportsSourcesList: false,
      supportsToolChoiceRequired: false,
    };
  }

  // OpenRouter can expose an OpenRouter-hosted search tool, but that is not the
  // same thing as guaranteed provider-native Google/OpenAI grounding forwarding.
  if (normalizedProvider === 'openrouter') {
    return {
      provider,
      modelId,
      supportsNativeWebSearch: false,
      supportsUrlCitations: true,
      supportsSourcesList: true,
      supportsToolChoiceRequired: false,
      supportsSearchContextSize: true,
    };
  }

  return {
    provider,
    modelId,
    supportsNativeWebSearch: false,
    supportsUrlCitations: false,
    supportsSourcesList: false,
    supportsToolChoiceRequired: false,
  };
}

export function supportsNativeWebSearch(provider: string, modelId: string): boolean {
  return getModelCapabilities(provider, modelId).supportsNativeWebSearch;
}
