import type { DocumentReference } from '../references/types';

export type { DocumentReference } from '../references/types';

export interface ReadDocumentResult {
  ref: DocumentReference;
  ok: boolean;
  contentText?: string;
  structured?: unknown;
  summary?: string;
  /** For image references: a base64 `data:` URL to pass to a vision model. */
  imageDataUrl?: string;
  /** For scanned/image PDFs: one base64 `data:` URL per page image, for vision. */
  imageDataUrls?: string[];
  metadata: {
    sizeBytes?: number;
    modifiedAt?: string;
    pageCount?: number;
    sheetNames?: string[];
    rowCount?: number;
    truncated?: boolean;
  };
  error?: string;
}

export interface FolderInventoryEntry {
  path: string;
  label: string;
  kind: 'file' | 'folder';
  extension?: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface FolderScanResult {
  ref: DocumentReference;
  ok: boolean;
  entries: FolderInventoryEntry[];
  groups: Record<string, number>;
  metadata: {
    totalEntries: number;
    truncated: boolean;
    maxEntries: number;
  };
  error?: string;
}

export interface DocumentReaderLimits {
  maxTextChars: number;
  maxRows: number;
  maxFolderEntries: number;
  maxDepth: number;
}

export interface FileMetadata {
  isDir?: boolean;
  isFile?: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
}

/** Tiered document extraction result (PDF/office). `method` is "text" when local text
 *  extraction succeeded ($0 tokens), "image" when the doc is scanned and page images are
 *  returned for vision, or "empty". */
export interface RichExtraction {
  method: 'text' | 'image' | 'empty';
  text: string;
  pageCount: number;
  /** base64 `data:` URLs, one per page image (scanned docs only). */
  images: string[];
}

export interface DocumentIO {
  readText(path: string): Promise<string>;
  readSheet(path: string, maxRows: number): Promise<unknown>;
  extractText?(path: string): Promise<string>;
  /** Tiered text+image extraction (PDF). Falls back to extractText when absent. */
  extractRich?(path: string): Promise<RichExtraction>;
  listDir(path: string): Promise<string[]>;
  metadata(path: string): Promise<FileMetadata>;
}

export interface DocumentReadOptions {
  io?: DocumentIO;
  limits?: Partial<DocumentReaderLimits>;
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentReaderLimits = {
  maxTextChars: 60_000,
  maxRows: 200,
  maxFolderEntries: 500,
  maxDepth: 4,
};
