import { describe, expect, it } from 'vitest';
import {
  citationsToWebCitations,
  sourcesFromSearchCitations,
  verifyWebAnswerQuality,
  webMetadataFromAgentSteps,
} from '../metadata';
import type { SearchCitation } from '../../search-citations';
import type { AgentStep } from '../../agent-loop';

describe('web search metadata', () => {
  it('turns OpenRouter citations into durable sources and citation links', () => {
    const citations: SearchCitation[] = [{
      citation_id: 'cite-1',
      sequence_number: 1,
      url: 'https://docs.example.com/product',
      title: 'Product docs',
      domain: 'docs.example.com',
      snippet: 'Official product documentation.',
      retrieved_at: '2026-06-24T10:00:00.000Z',
    }];

    const sources = sourcesFromSearchCitations(citations);
    const webCitations = citationsToWebCitations(citations, sources);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      url: 'https://docs.example.com/product',
      domain: 'docs.example.com',
      kind: 'citation',
      confidence: 'high',
    });
    expect(webCitations[0]).toMatchObject({
      id: 'cite-1',
      sourceId: sources[0].id,
      sequenceNumber: 1,
    });
  });

  it('extracts web runs and sources from agent step details', () => {
    const steps: AgentStep[] = [{
      id: 's1',
      type: 'tool_result',
      tool: 'web.search',
      timestamp: '2026-06-24T10:01:00.000Z',
      output: '',
      details: {
        webSearch: {
          query: 'Larund Click web search',
          provider: 'brave',
          searchedAt: '2026-06-24T10:01:00.000Z',
          results: [{
            title: 'Larund Click',
            url: 'https://example.com/larund',
            snippet: 'A result',
            rank: 1,
          }],
        },
      },
    }];

    const metadata = webMetadataFromAgentSteps(steps);

    expect(metadata.runs).toHaveLength(1);
    expect(metadata.runs[0]).toMatchObject({ query: 'Larund Click web search', provider: 'brave', returnedResults: 1 });
    expect(metadata.sources[0]).toMatchObject({ url: 'https://example.com/larund', query: 'Larund Click web search' });
    expect(metadata.toolsUsed).toContain('web.search');
  });

  it('flags source-backed answers that are too thin', () => {
    const sources = sourcesFromSearchCitations([{
      citation_id: 'cite-1',
      sequence_number: 1,
      url: 'https://example.com/news',
      title: 'News',
      domain: 'example.com',
      retrieved_at: '2026-06-24T10:00:00.000Z',
    }]);

    const result = verifyWebAnswerQuality('It changed recently.[^1]', sources, { webSearchMode: 'fast' });

    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/too thin/i);
  });
});
