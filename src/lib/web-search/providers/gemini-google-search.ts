import type { WebSearchRequest } from '../web-search-router';

export interface GeminiGoogleSearchRequestBody {
  model: string;
  contents: Array<{ role: 'user'; parts: Array<{ text: string }> }>;
  tools: Array<{ google_search: Record<string, never> }>;
}

export function buildGeminiGoogleSearchRequest(request: WebSearchRequest): GeminiGoogleSearchRequestBody {
  return {
    model: request.selectedModel.modelId,
    contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
    tools: [{ google_search: {} }],
  };
}

export function extractGeminiUrlCitations(response: unknown): Array<{ url: string; title?: string; startIndex?: number; endIndex?: number }> {
  const citations: Array<{ url: string; title?: string; startIndex?: number; endIndex?: number }> = [];
  const chunks = collectObjects(response);
  for (const item of chunks) {
    const metadata = item.groundingMetadata as Record<string, unknown> | undefined;
    const supports = Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : [];
    const chunksRaw = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
    for (const support of supports as Array<Record<string, unknown>>) {
      const indices = Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : [];
      for (const index of indices) {
        const chunk = chunksRaw[Number(index)] as Record<string, unknown> | undefined;
        const web = chunk?.web as Record<string, unknown> | undefined;
        if (typeof web?.uri === 'string') {
          const segment = support.segment as Record<string, unknown> | undefined;
          citations.push({
            url: web.uri,
            title: typeof web.title === 'string' ? web.title : undefined,
            startIndex: typeof segment?.startIndex === 'number' ? segment.startIndex : undefined,
            endIndex: typeof segment?.endIndex === 'number' ? segment.endIndex : undefined,
          });
        }
      }
    }
  }
  return citations;
}

function collectObjects(value: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node)) out.push(node as Record<string, unknown>);
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(value);
  return out;
}
