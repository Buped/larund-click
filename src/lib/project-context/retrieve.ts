import { PROJECT_CONTEXT_LIMITS } from './limits';
import { listProjectSourceChunks, listProjectSources, markProjectSourcesUsed, recordProjectContextEvent } from './store';
import type { ProjectSource, ProjectSourceChunk, RetrieveProjectContextInput, RetrievedProjectChunk } from './types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'about', 'your', 'what', 'when', 'where', 'how',
  'egy', 'vagy', 'hogy', 'mint', 'projekt', 'forras', 'alapjan', 'kerlek', 'mi', 'mit', 'hogyan', 'mikor', 'hol',
]);

function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9_]{3,}/g) ?? [])]
    .filter((term) => !STOP_WORDS.has(term));
}

function scoreChunk(queryTerms: string[], queryLower: string, source: ProjectSource, chunk: ProjectSourceChunk): number {
  const title = source.title.toLowerCase();
  const heading = (chunk.heading ?? '').toLowerCase();
  const content = chunk.content.toLowerCase();
  let score = 0;
  if (title && queryLower.includes(title)) score += 60;
  for (const term of queryTerms) {
    if (title.includes(term)) score += 16;
    if (heading.includes(term)) score += 10;
    if (content.includes(term)) score += 3;
  }
  if (source.lastIndexedAt) score += 0.5;
  return score;
}

export async function retrieveProjectContext(input: RetrieveProjectContextInput): Promise<RetrievedProjectChunk[]> {
  const limit = Math.min(input.limit ?? PROJECT_CONTEXT_LIMITS.maxRetrievedChunksPerMessage, PROJECT_CONTEXT_LIMITS.maxRetrievedChunksPerMessage);
  const queryTerms = terms(input.query);
  if (queryTerms.length === 0 && !input.sourceIds?.length) return [];

  const [sources, chunks] = await Promise.all([
    listProjectSources(input.projectId),
    listProjectSourceChunks(input.projectId),
  ]);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const allowedSourceIds = input.sourceIds?.length ? new Set(input.sourceIds) : null;
  const queryLower = input.query.toLowerCase();
  const scored = chunks
    .map((chunk) => {
      const source = sourceById.get(chunk.sourceId);
      if (!source || !source.isEnabled || source.status !== 'ready') return null;
      if (allowedSourceIds && !allowedSourceIds.has(source.id)) return null;
      const score = allowedSourceIds?.has(source.id) ? 30 + scoreChunk(queryTerms, queryLower, source, chunk) : scoreChunk(queryTerms, queryLower, source, chunk);
      if (score <= 0) return null;
      return {
        sourceId: source.id,
        sourceTitle: source.title,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score,
        citationLabel: `${source.title}#${chunk.chunkIndex + 1}`,
      } satisfies RetrievedProjectChunk;
    })
    .filter((item): item is RetrievedProjectChunk => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length) {
    await markProjectSourcesUsed([...new Set(scored.map((item) => item.sourceId))]).catch(() => undefined);
    await recordProjectContextEvent(input.projectId, null, 'retrieval_used', {
      query: input.query.slice(0, 300),
      sourceIds: [...new Set(scored.map((item) => item.sourceId))],
      chunkCount: scored.length,
    }).catch(() => undefined);
  }
  return scored;
}
