import type { ReadDocumentResult } from './types';

export function summarizeText(text: string, maxChars = 900): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trim()}...`;
}

export function summarizeDocument(result: ReadDocumentResult): string {
  if (!result.ok) return `Read failed: ${result.error ?? 'unknown error'}`;
  const parts: string[] = [];
  if (result.metadata.rowCount != null) parts.push(`${result.metadata.rowCount} rows`);
  if (result.metadata.sheetNames?.length) parts.push(`sheets: ${result.metadata.sheetNames.join(', ')}`);
  if (result.metadata.truncated) parts.push('truncated');
  if (result.contentText) parts.push(summarizeText(result.contentText));
  return parts.join(' | ') || 'Document read successfully.';
}
