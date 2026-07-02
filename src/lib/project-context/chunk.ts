import { PROJECT_CONTEXT_LIMITS } from './limits';
import type { ProjectSourceChunk } from './types';

const TOKEN_CHARS = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHARS);
}

export function normalizeProjectSourceText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

export function looksBinary(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 4096);
  if (sample.includes('\u0000')) return true;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    const printable = code === 9 || code === 10 || code === 13 || code >= 32;
    if (!printable) suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}

export function detectLikelySecrets(text: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{12,}/],
    ['Slack token', /\bxoxb-[A-Za-z0-9-]{10,}/],
    ['GitHub token', /\bghp_[A-Za-z0-9_]{20,}/],
    ['Google API key', /\bAIza[A-Za-z0-9_-]{16,}/],
    ['Private key', /-----BEGIN PRIVATE KEY-----/],
    ['Password assignment', /\bpassword\s*=/i],
    ['API key assignment', /\bapi_key\s*=/i],
    ['Access token assignment', /\baccess_token\s*=/i],
  ];
  return checks.filter(([, re]) => re.test(text)).map(([label]) => label);
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function headingFor(text: string): string | null {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return null;
  const clean = firstLine.replace(/^#{1,6}\s*/, '').trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

export function chunkProjectSourceText(args: {
  projectId: string;
  sourceId: string;
  text: string;
  now?: string;
}): Omit<ProjectSourceChunk, 'id'>[] {
  const target = PROJECT_CONTEXT_LIMITS.chunkTargetChars;
  const overlap = PROJECT_CONTEXT_LIMITS.chunkOverlapChars;
  const now = args.now ?? new Date().toISOString();
  const chunks: Omit<ProjectSourceChunk, 'id'>[] = [];
  let start = 0;
  let index = 0;
  const text = args.text.trim();
  while (start < text.length) {
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start + Math.floor(target * 0.55)) end = newline;
      else {
        const space = text.lastIndexOf(' ', end);
        if (space > start + Math.floor(target * 0.55)) end = space;
      }
    }
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        sourceId: args.sourceId,
        projectId: args.projectId,
        chunkIndex: index,
        heading: headingFor(content),
        content,
        charCount: content.length,
        tokenEstimate: estimateTokens(content),
        metadataJson: {},
        createdAt: now,
      });
      index += 1;
    }
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function extractiveSummary(text: string, title = 'Source', maxChars = 1200): string {
  const normalized = normalizeProjectSourceText(text);
  if (!normalized) return '';
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const headingLines = lines.filter((line) => /^#{1,6}\s+/.test(line) || /^[A-Z0-9][^.!?]{4,80}:$/.test(line)).slice(0, 6);
  const lead = lines.join(' ').replace(/\s+/g, ' ').slice(0, maxChars);
  const summary = [`${title}: ${lead}`, headingLines.length ? `Key headings: ${headingLines.join('; ')}` : ''].filter(Boolean).join('\n');
  return summary.length > maxChars ? `${summary.slice(0, maxChars - 3)}...` : summary;
}
