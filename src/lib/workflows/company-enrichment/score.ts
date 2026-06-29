import type { SourceCandidate } from './types';

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !['kft', 'zrt', 'bt', 'ltd', 'inc', 'llc'].includes(t));
}

export function scoreCandidate(companyName: string, candidate: SourceCandidate): number {
  const companyTokens = tokens(companyName);
  const haystack = `${candidate.url} ${candidate.title ?? ''} ${candidate.snippet ?? ''}`;
  const hayTokens = new Set(tokens(haystack));
  const matches = companyTokens.filter((token) => hayTokens.has(token)).length;
  let score = candidate.confidence + (companyTokens.length ? matches / companyTokens.length : 0) * 0.35;
  if (/linkedin\.com\/company/i.test(candidate.url)) score += 0.08;
  if (/(contact|kapcsolat|elerhetoseg|el[eĂ©]rhet[oĹő]s[eĂ©]g)/i.test(haystack)) score += 0.06;
  if (/(official|hivatalos)/i.test(haystack)) score += 0.08;
  return Math.max(0, Math.min(1, score));
}
