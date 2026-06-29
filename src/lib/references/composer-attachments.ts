import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { DocumentReference } from './types';
import { referenceFromPath, referenceFromUrl } from './local-picker';

export interface ComposerAttachmentOptions {
  scopeId?: string | null;
  now?: () => number;
  writeBytes?: (path: string, bytes: Uint8Array) => Promise<void>;
  metadata?: (path: string) => Promise<{ is_dir?: boolean; is_file?: boolean } | null>;
  attachmentRoot?: () => Promise<string>;
}

type PathLikeFile = File & { path?: string };

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

const MIME_BY_EXT: Record<string, string> = {
  ...IMAGE_MIME,
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function inferMimeType(nameOrPath: string): string | undefined {
  const ext = extensionOf(nameOrPath);
  return ext ? MIME_BY_EXT[ext] : undefined;
}

export function referenceKey(ref: DocumentReference): string {
  return `${ref.kind}:${ref.path ?? ref.url ?? ref.driveFileId ?? ref.id}`.toLowerCase();
}

export function dedupeDocumentReferences(refs: DocumentReference[]): DocumentReference[] {
  const seen = new Set<string>();
  const out: DocumentReference[] = [];
  for (const ref of refs) {
    const key = referenceKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function mergeDocumentReferences(existing: DocumentReference[], incoming: DocumentReference[]): DocumentReference[] {
  return dedupeDocumentReferences([...existing, ...incoming]);
}

export function referencesFromPlainText(text: string): DocumentReference[] {
  const refs: DocumentReference[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = normalizeDroppedTextPath(raw);
    if (!line) continue;
    if (/^https?:\/\//i.test(line)) {
      refs.push(referenceFromUrl(line));
      continue;
    }
    if (isLikelyPath(line)) {
      refs.push(withInferredMime(referenceFromPath(line, 'file')));
    }
  }
  return dedupeDocumentReferences(refs);
}

function normalizeDroppedTextPath(raw: string): string {
  const value = raw.trim();
  if (!/^file:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(url.pathname);
    return decoded.replace(/^\/([a-zA-Z]:[\\/])/, '$1');
  } catch {
    return decodeURI(value.replace(/^file:\/\//i, '')).replace(/^\/([a-zA-Z]:[\\/])/, '$1');
  }
}

export async function referencesFromDroppedDataTransfer(
  dataTransfer: DataTransfer,
  options: ComposerAttachmentOptions = {},
): Promise<DocumentReference[]> {
  const refs: DocumentReference[] = [];
  for (const file of Array.from(dataTransfer.files || []) as PathLikeFile[]) {
    if (file.path) {
      refs.push(await referenceFromLocalPath(file.path, options, file.type));
    } else {
      refs.push(await persistClipboardFile(file, options));
    }
  }
  const text = dataTransfer.getData('text/plain')?.trim();
  if (text) {
    for (const ref of referencesFromPlainText(text)) {
      refs.push(ref.path ? await referenceFromLocalPath(ref.path, options, ref.mimeType) : ref);
    }
  }
  return dedupeDocumentReferences(refs);
}

export async function referencesFromClipboardEvent(
  clipboardData: DataTransfer | null,
  options: ComposerAttachmentOptions = {},
): Promise<DocumentReference[]> {
  if (!clipboardData) return [];
  const refs: DocumentReference[] = [];
  const items = Array.from(clipboardData.items || []);

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile() as PathLikeFile | null;
    if (!file) continue;
    if (file.path) {
      refs.push(await referenceFromLocalPath(file.path, options, file.type));
      continue;
    }
    refs.push(await persistClipboardFile(file, options));
  }

  for (const file of Array.from(clipboardData.files || []) as PathLikeFile[]) {
    if (file.path) refs.push(await referenceFromLocalPath(file.path, options, file.type));
  }

  return dedupeDocumentReferences(refs);
}

export async function referenceFromLocalPath(
  path: string,
  options: ComposerAttachmentOptions = {},
  mimeType?: string,
): Promise<DocumentReference> {
  const metadata = await readMetadata(path, options);
  const ref = referenceFromPath(path, metadata?.is_dir ? 'folder' : 'file');
  return withInferredMime({ ...ref, mimeType: metadata?.is_dir ? undefined : (mimeType || inferMimeType(path)) });
}

export async function persistClipboardFile(
  file: File,
  options: ComposerAttachmentOptions = {},
): Promise<DocumentReference> {
  const now = options.now?.() ?? Date.now();
  const safeName = safeFileName(file.name || defaultClipboardName(file.type, now));
  const root = await attachmentRoot(options);
  const scope = safeFileName(options.scopeId || 'draft');
  const path = await safeJoin(root, 'attachments', scope, `${now}-${safeName}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeBytes(path, bytes, options);
  return withInferredMime({ ...referenceFromPath(path, 'file'), label: safeName, mimeType: file.type || inferMimeType(safeName) });
}

async function readMetadata(path: string, options: ComposerAttachmentOptions) {
  if (options.metadata) return options.metadata(path);
  try {
    const raw = await invoke<string>('fs_metadata', { path });
    return JSON.parse(raw) as { is_dir?: boolean; is_file?: boolean };
  } catch {
    return null;
  }
}

async function writeBytes(path: string, bytes: Uint8Array, options: ComposerAttachmentOptions) {
  if (options.writeBytes) return options.writeBytes(path, bytes);
  await invoke<string>('file_write_bytes', { path, bytes: Array.from(bytes) });
}

async function attachmentRoot(options: ComposerAttachmentOptions): Promise<string> {
  if (options.attachmentRoot) return options.attachmentRoot();
  try {
    return await appDataDir();
  } catch {
    return '~/LarundClick';
  }
}

async function safeJoin(...parts: string[]): Promise<string> {
  try {
    return await join(...parts);
  } catch {
    return parts.join('/').replace(/\/+/g, '/');
  }
}

function withInferredMime(ref: DocumentReference): DocumentReference {
  if (ref.mimeType || ref.kind !== 'file') return ref;
  return { ...ref, mimeType: inferMimeType(ref.path ?? ref.label) };
}

function defaultClipboardName(mimeType: string, now: number): string {
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'bin';
  return `clipboard-${now}.${ext}`;
}

function safeFileName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').slice(0, 96) || 'attachment';
}

function extensionOf(nameOrPath: string): string {
  const name = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isLikelyPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\') || value.startsWith('~/');
}
