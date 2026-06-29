import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('web search provider', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('normalizes Brave search results', async () => {
    vi.stubEnv('VITE_BRAVE_SEARCH_API_KEY', 'test-key');
    const { webSearch } = await import('../provider');
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        web: {
          results: [
            { title: 'Acme official', url: 'https://acme.example', description: 'Official site' },
          ],
        },
      }),
    });
    const result = await webSearch({ query: 'Acme official website', maxResults: 5 });
    expect(result.provider).toBe('brave');
    expect(result.results[0]).toMatchObject({ title: 'Acme official', url: 'https://acme.example', rank: 1 });
  });

  it('batch search handles many queries with a concurrency limit', async () => {
    vi.stubEnv('VITE_BRAVE_SEARCH_API_KEY', 'test-key');
    const { webBatchSearch } = await import('../provider');
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ web: { results: [{ title: 'Result', url: 'https://example.com', description: 'Snippet' }] } }),
    });
    const results = await webBatchSearch({ queries: Array.from({ length: 25 }, (_, i) => `Company ${i}`), concurrency: 3 });
    expect(results).toHaveLength(25);
    expect(invokeMock).toHaveBeenCalledTimes(25);
  });

  it('extracts contact info from page text', async () => {
    const { extractContactInfo } = await import('../provider');
    const info = extractContactInfo('https://acme.example', 'Email info@acme.example Tel +36 1 234 5678 https://linkedin.com/company/acme');
    expect(info.emails).toContain('info@acme.example');
    expect(info.phones[0]).toContain('+36');
    expect(info.links.linkedin).toContain('linkedin.com/company/acme');
  });
});
