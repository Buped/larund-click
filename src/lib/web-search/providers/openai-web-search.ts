import type { WebSearchRequest } from '../web-search-router';

export interface OpenAIWebSearchRequestBody {
  model: string;
  input: string;
  tools: Array<{ type: 'web_search'; search_context_size?: 'low' | 'medium' | 'high' }>;
  tool_choice?: 'required' | { type: 'web_search' };
}

export function buildOpenAIWebSearchRequest(request: WebSearchRequest): OpenAIWebSearchRequestBody {
  return {
    model: request.selectedModel.modelId,
    input: request.userPrompt,
    tools: [{
      type: 'web_search',
      search_context_size: contextSize(request.searchDepth),
    }],
    tool_choice: request.webMode === 'required' ? 'required' : undefined,
  };
}

export function extractOpenAIUrlCitations(response: unknown): Array<{ url: string; title?: string; startIndex?: number; endIndex?: number }> {
  const citations: Array<{ url: string; title?: string; startIndex?: number; endIndex?: number }> = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if ((item.type === 'url_citation' || item.type === 'citation') && typeof item.url === 'string') {
      citations.push({
        url: item.url,
        title: typeof item.title === 'string' ? item.title : undefined,
        startIndex: typeof item.start_index === 'number' ? item.start_index : undefined,
        endIndex: typeof item.end_index === 'number' ? item.end_index : undefined,
      });
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  };
  walk(response);
  return citations;
}

function contextSize(depth: WebSearchRequest['searchDepth']): 'low' | 'medium' | 'high' {
  if (depth === 'quick') return 'low';
  if (depth === 'extended') return 'high';
  return 'medium';
}
