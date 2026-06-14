import type { ReadDocumentResult } from './types';

const cache = new Map<string, ReadDocumentResult>();

function key(pathOrUrl: string, modifiedAt?: string): string {
  return `${pathOrUrl}::${modifiedAt ?? ''}`;
}

export function getCachedDocument(pathOrUrl: string, modifiedAt?: string): ReadDocumentResult | undefined {
  return cache.get(key(pathOrUrl, modifiedAt));
}

export function setCachedDocument(pathOrUrl: string, result: ReadDocumentResult, modifiedAt?: string): void {
  cache.set(key(pathOrUrl, modifiedAt), result);
}

export function clearDocumentCache(): void {
  cache.clear();
}
