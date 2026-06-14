import { invoke } from '@tauri-apps/api/core';
import type { DocumentReference } from '../references/types';
import {
  DEFAULT_DOCUMENT_LIMITS,
  type DocumentIO,
  type DocumentReadOptions,
  type FileMetadata,
  type ReadDocumentResult,
} from './types';
import { summarizeDocument, summarizeText } from './summarize';
import { getCachedDocument, setCachedDocument } from './cache';

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.log']);
const SHEET_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.ods']);
const OFFICE_EXT = new Set(['.docx', '.doc', '.pptx', '.pdf']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function extOf(pathOrLabel: string): string {
  const name = pathOrLabel.split(/[\\/]/).pop() ?? pathOrLabel;
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function defaultIo(): DocumentIO {
  return {
    async readText(path: string) {
      return invoke<string>('file_read', { path });
    },
    async readSheet(path: string, maxRows: number) {
      const raw = await invoke<string>('sheet_read', { path, sheet: null, maxRows });
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    async listDir(path: string) {
      return invoke<string[]>('dir_list', { path });
    },
    async metadata(path: string) {
      const raw = await invoke<string>('fs_metadata', { path });
      try {
        const parsed = JSON.parse(raw) as { is_dir?: boolean; is_file?: boolean; size?: number; modified_unix?: number };
        return {
          isDir: parsed.is_dir,
          isFile: parsed.is_file,
          sizeBytes: parsed.size,
          modifiedAt: parsed.modified_unix ? new Date(parsed.modified_unix * 1000).toISOString() : undefined,
        };
      } catch {
        return {};
      }
    },
  };
}

export function getDefaultDocumentIO(): DocumentIO {
  return defaultIo();
}

function normalizeMetadata(metadata: FileMetadata): ReadDocumentResult['metadata'] {
  return {
    sizeBytes: metadata.sizeBytes,
    modifiedAt: metadata.modifiedAt,
  };
}

export async function readDocument(ref: DocumentReference, options: DocumentReadOptions = {}): Promise<ReadDocumentResult> {
  const io = options.io ?? getDefaultDocumentIO();
  const limits = { ...DEFAULT_DOCUMENT_LIMITS, ...options.limits };
  const target = ref.path ?? ref.url ?? '';
  const ext = extOf(target || ref.label);

  if (!target) {
    return { ref, ok: false, metadata: {}, error: 'missing_path_or_url' };
  }
  if (ref.kind === 'url') {
    return {
      ref,
      ok: false,
      metadata: {},
      error: 'url_document_read_requires_browser_or_connection',
      summary: 'URL references are tracked, but must be read through browser/connection tools.',
    };
  }

  try {
    const md: FileMetadata = await io.metadata(target).catch(() => ({}));
    const cached = getCachedDocument(target, md.modifiedAt);
    if (cached) return cached;

    let result: ReadDocumentResult;
    if (TEXT_EXT.has(ext)) {
      const raw = await io.readText(target);
      const cut = truncate(raw, limits.maxTextChars);
      const structured = ext === '.csv' ? { rows: parseCsv(cut.text) } : ext === '.json' ? tryParseJson(cut.text) : undefined;
      result = {
        ref,
        ok: true,
        contentText: cut.text,
        structured,
        metadata: {
          ...normalizeMetadata(md),
          rowCount: ext === '.csv' ? (structured as { rows: string[][] } | undefined)?.rows.length : undefined,
          truncated: cut.truncated,
        },
      };
    } else if (SHEET_EXT.has(ext)) {
      const structured = await io.readSheet(target, limits.maxRows);
      result = sheetResult(ref, md, structured);
    } else if (OFFICE_EXT.has(ext)) {
      result = {
        ref,
        ok: true,
        contentText: '',
        structured: { extraction: 'metadata_only', format: ext.slice(1) },
        metadata: normalizeMetadata(md),
        summary: `${ext.slice(1).toUpperCase()} metadata read. Text extraction is scaffolded for the native reader.`,
      };
    } else if (IMAGE_EXT.has(ext)) {
      result = {
        ref,
        ok: true,
        structured: { extraction: 'metadata_only', format: ext.slice(1), ocr: 'not_enabled' },
        metadata: normalizeMetadata(md),
        summary: 'Image metadata read. OCR/vision is intentionally not used yet.',
      };
    } else {
      result = {
        ref,
        ok: false,
        metadata: normalizeMetadata(md),
        error: `unsupported_format:${ext || 'none'}`,
      };
    }
    result.summary = result.summary ?? summarizeDocument(result);
    setCachedDocument(target, result, md.modifiedAt);
    return result;
  } catch (error) {
    return { ref, ok: false, metadata: {}, error: String(error) };
  }
}

export async function readManyDocuments(
  refs: DocumentReference[],
  options: DocumentReadOptions = {},
): Promise<ReadDocumentResult[]> {
  const results: ReadDocumentResult[] = [];
  for (const ref of refs) {
    results.push(await readDocument(ref, options));
  }
  return results;
}

export function summarizeReadResults(results: ReadDocumentResult[]): string {
  return results.map((r) => {
    const target = r.ref.path ?? r.ref.url ?? r.ref.label;
    return `${r.ok ? 'OK' : 'FAILED'} ${r.ref.id} ${target}: ${r.summary ?? r.error ?? summarizeText(r.contentText ?? '')}`;
  }).join('\n');
}

function sheetResult(ref: DocumentReference, md: FileMetadata, structured: unknown): ReadDocumentResult {
  const data = structured as { rows?: unknown[]; row_count?: number; sheet?: string; sheetNames?: string[]; truncated?: boolean };
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return {
    ref,
    ok: true,
    contentText: rows.length ? JSON.stringify(rows.slice(0, 20)) : JSON.stringify(structured),
    structured,
    metadata: {
      ...normalizeMetadata(md),
      rowCount: typeof data?.row_count === 'number' ? data.row_count : rows.length,
      sheetNames: data?.sheet ? [data.sheet] : data?.sheetNames,
      truncated: Boolean(data?.truncated),
    },
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
