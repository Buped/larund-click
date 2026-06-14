import type { DocumentReference } from '../references/types';

export type { DocumentReference } from '../references/types';

export interface ReadDocumentResult {
  ref: DocumentReference;
  ok: boolean;
  contentText?: string;
  structured?: unknown;
  summary?: string;
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

export interface DocumentIO {
  readText(path: string): Promise<string>;
  readSheet(path: string, maxRows: number): Promise<unknown>;
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
