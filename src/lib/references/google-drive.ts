import { invoke } from '@tauri-apps/api/core';
import type { DocumentReference } from './types';
import type { ImageBlock } from './ingest';
import type { ReadDocumentResult } from '../document-reader';
import { readDocument, summarizeReadResults } from '../document-reader';
import { resolveRuntimeCredentials } from '../connections/runtimeCredentials';
import { GOOGLE_BASE, DOCS_BASE, googleApiFetch, googleDownloadBytes, mapGoogleError } from '../connections/providers/google-workspace/client';

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const SLIDES_BASE = 'https://slides.googleapis.com';
const MAX_FOLDER_ITEMS = 50;
const MAX_SHEET_TABS = 4;
const MAX_SHEET_ROWS = 50;
const MAX_DOWNLOAD_BYTES = 24 * 1024 * 1024;

export type DriveFileTypeFilter = 'all' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'image';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

export interface DrivePickerState {
  ok: boolean;
  token?: string;
  message?: string;
}

export interface DriveResolvedReference {
  ref: DocumentReference;
  ok: boolean;
  output: string;
  textBlock?: string;
  imageBlocks?: ImageBlock[];
  error?: string;
  documentRead?: ReadDocumentResult;
}

function qString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function addTypeFilter(clauses: string[], type: DriveFileTypeFilter): void {
  if (type === 'docs') clauses.push(`mimeType=${qString(GOOGLE_DOC_MIME)}`);
  if (type === 'sheets') clauses.push(`mimeType=${qString(GOOGLE_SHEET_MIME)}`);
  if (type === 'slides') clauses.push(`mimeType=${qString(GOOGLE_SLIDES_MIME)}`);
  if (type === 'pdf') clauses.push(`mimeType=${qString('application/pdf')}`);
  if (type === 'image') clauses.push(`mimeType contains ${qString('image/')}`);
}

function ownerOf(item: DriveFileItem): string | undefined {
  const owner = item.owners?.[0];
  return owner?.displayName ?? owner?.emailAddress;
}

function kindFor(item: DriveFileItem): DocumentReference['kind'] {
  if (item.mimeType === DRIVE_FOLDER_MIME) return 'google_drive_folder';
  if (item.mimeType === GOOGLE_DOC_MIME) return 'google_doc';
  if (item.mimeType === GOOGLE_SHEET_MIME) return 'google_sheet';
  if (item.mimeType === GOOGLE_SLIDES_MIME) return 'google_slide';
  return 'google_drive_file';
}

function extensionFor(ref: DocumentReference): string {
  const name = ref.label;
  const fromName = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (fromName) return fromName;
  const mime = ref.mimeType ?? '';
  if (mime === 'application/pdf') return '.pdf';
  if (mime.includes('wordprocessingml')) return '.docx';
  if (mime.includes('spreadsheetml')) return '.xlsx';
  if (mime.includes('presentationml')) return '.pptx';
  if (mime === 'text/plain') return '.txt';
  if (mime === 'text/csv') return '.csv';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.bin';
}

function refFromDriveItem(item: DriveFileItem): DocumentReference {
  return {
    id: `drive-${item.id}`,
    kind: kindFor(item),
    label: item.name,
    driveFileId: item.id,
    url: item.webViewLink,
    webViewLink: item.webViewLink,
    mimeType: item.mimeType,
    lastModified: item.modifiedTime,
    owner: ownerOf(item),
    source: 'connection',
  };
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function tempPathFor(ref: DocumentReference): string {
  const safeId = (ref.driveFileId ?? ref.id).replace(/[^a-zA-Z0-9_-]/g, '');
  return `~/.larund/tmp/drive-${safeId}-${Date.now()}${extensionFor(ref)}`;
}

async function tokenForGoogle(userId: string): Promise<string> {
  const resolved = await resolveRuntimeCredentials('google-workspace', { userId });
  if (resolved.ok && resolved.secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN) return resolved.secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN;
  throw new Error(resolved.message ?? 'A Google Workspace nincs bekotve. Nyisd meg a Connections oldalt, es kapcsold be a Google connectiont.');
}

export async function googleDriveConnectionState(userId: string): Promise<DrivePickerState> {
  try {
    return { ok: true, token: await tokenForGoogle(userId) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function driveList(token: string, q: string, pageSize = 30): Promise<DriveFileItem[]> {
  const fields = 'files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress))';
  const data = await googleApiFetch(
    'drive',
    `${GOOGLE_BASE}/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${pageSize}&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}`,
    token,
  ) as { files?: DriveFileItem[] };
  return data.files ?? [];
}

export async function listRecentDriveItems(userId: string, type: DriveFileTypeFilter = 'all'): Promise<DocumentReference[]> {
  const token = await tokenForGoogle(userId);
  const clauses = ['trashed=false'];
  addTypeFilter(clauses, type);
  const items = await driveList(token, clauses.join(' and '), 30);
  return items.map(refFromDriveItem);
}

export async function listDriveFolder(userId: string, folderId = 'root', type: DriveFileTypeFilter = 'all'): Promise<DocumentReference[]> {
  const token = await tokenForGoogle(userId);
  const clauses = [`${qString(folderId)} in parents`, 'trashed=false'];
  addTypeFilter(clauses, type);
  const items = await driveList(token, clauses.join(' and '), MAX_FOLDER_ITEMS);
  return items.map(refFromDriveItem);
}

export async function searchDriveItems(userId: string, query: string, type: DriveFileTypeFilter): Promise<DocumentReference[]> {
  const token = await tokenForGoogle(userId);
  const clauses = ['trashed=false'];
  const trimmed = query.trim();
  if (trimmed) clauses.push(`(name contains ${qString(trimmed)} or fullText contains ${qString(trimmed)})`);
  addTypeFilter(clauses, type);
  const items = await driveList(token, clauses.join(' and '), 30);
  return items.map(refFromDriveItem);
}

async function getDriveMetadata(token: string, fileId: string): Promise<DriveFileItem & { size?: string }> {
  return googleApiFetch(
    'drive',
    `${GOOGLE_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,name,mimeType,webViewLink,modifiedTime,size,owners(displayName,emailAddress)')}`,
    token,
  ) as Promise<DriveFileItem & { size?: string }>;
}

function extractDocText(doc: unknown): string {
  const blocks: string[] = [];
  const content = (doc as { body?: { content?: unknown[] } }).body?.content ?? [];
  for (const block of content) {
    const paragraph = (block as { paragraph?: { elements?: unknown[]; paragraphStyle?: { namedStyleType?: string } } }).paragraph;
    if (!paragraph) continue;
    const text = (paragraph.elements ?? [])
      .map((el) => (el as { textRun?: { content?: string } }).textRun?.content ?? '')
      .join('')
      .trimEnd();
    if (!text.trim()) continue;
    const style = paragraph.paragraphStyle?.namedStyleType ?? '';
    const prefix = style.includes('HEADING_1') ? '# ' : style.includes('HEADING_2') ? '## ' : style.includes('HEADING_3') ? '### ' : '';
    blocks.push(`${prefix}${text}`);
  }
  return blocks.join('\n').trim();
}

async function readGoogleDoc(token: string, ref: DocumentReference): Promise<DriveResolvedReference> {
  const data = await googleApiFetch('docs', `${DOCS_BASE}/v1/documents/${encodeURIComponent(ref.driveFileId!)}`, token);
  const text = extractDocText(data);
  const textBlock = `### Google Docs: ${ref.label}\n${text || '[empty document]'}`;
  return { ref: { ...ref, resolvedContentSummary: text.slice(0, 700) }, ok: true, output: `OK ${ref.label}: Google Doc read via Docs API`, textBlock };
}

async function readGoogleSheet(token: string, ref: DocumentReference): Promise<DriveResolvedReference> {
  const meta = await googleApiFetch(
    'sheets',
    `${GOOGLE_BASE}/v4/spreadsheets/${encodeURIComponent(ref.driveFileId!)}?includeGridData=false`,
    token,
  ) as { sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }> };
  const chunks: string[] = [];
  for (const sheet of (meta.sheets ?? []).slice(0, MAX_SHEET_TABS)) {
    const props = sheet.properties ?? {};
    const title = props.title ?? 'Sheet';
    const range = `${title}!A1:Z${MAX_SHEET_ROWS}`;
    const values = await googleApiFetch(
      'sheets',
      `${GOOGLE_BASE}/v4/spreadsheets/${encodeURIComponent(ref.driveFileId!)}/values/${encodeURIComponent(range)}`,
      token,
    ) as { values?: unknown[][] };
    chunks.push([
      `#### ${title}`,
      `rows: ${props.gridProperties?.rowCount ?? 'unknown'}, columns: ${props.gridProperties?.columnCount ?? 'unknown'}, shown: first ${MAX_SHEET_ROWS} rows / A-Z`,
      JSON.stringify(values.values ?? []),
    ].join('\n'));
  }
  const text = chunks.join('\n\n') || '[empty spreadsheet]';
  return { ref: { ...ref, resolvedContentSummary: text.slice(0, 700) }, ok: true, output: `OK ${ref.label}: Google Sheet read via Sheets API`, textBlock: `### Google Sheet: ${ref.label}\n${text}` };
}

function collectSlideText(value: unknown, parts: string[]) {
  if (!value || typeof value !== 'object') return;
  const run = (value as { textRun?: { content?: string } }).textRun;
  if (run?.content?.trim()) parts.push(run.content.trim());
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) child.forEach((item) => collectSlideText(item, parts));
    else if (child && typeof child === 'object') collectSlideText(child, parts);
  }
}

async function readGoogleSlides(token: string, ref: DocumentReference): Promise<DriveResolvedReference> {
  const data = await googleApiFetch('slides', `${SLIDES_BASE}/v1/presentations/${encodeURIComponent(ref.driveFileId!)}`, token) as { slides?: unknown[] };
  const slides = (data.slides ?? []).map((slide, index) => {
    const parts: string[] = [];
    collectSlideText(slide, parts);
    return `Slide ${index + 1}: ${parts.join(' ').trim() || '[no text]'}`;
  });
  const text = slides.join('\n');
  return { ref: { ...ref, resolvedContentSummary: text.slice(0, 700) }, ok: true, output: `OK ${ref.label}: Google Slides read via Slides API`, textBlock: `### Google Slides: ${ref.label}\n${text}` };
}

async function readDriveFolder(token: string, ref: DocumentReference): Promise<DriveResolvedReference> {
  const items = await driveList(token, `${qString(ref.driveFileId!)} in parents and trashed=false`, MAX_FOLDER_ITEMS);
  const lines = items.map((item) => `- ${item.name} (${item.mimeType})${item.modifiedTime ? `, modified ${item.modifiedTime}` : ''}`);
  const text = lines.join('\n') || '[empty folder]';
  return { ref: { ...ref, resolvedContentSummary: text.slice(0, 700) }, ok: true, output: `OK ${ref.label}: listed ${items.length} Drive folder item(s)`, textBlock: `### Google Drive folder: ${ref.label}\n${text}` };
}

async function readDownloadedDriveFile(token: string, ref: DocumentReference): Promise<DriveResolvedReference> {
  const bytes = await googleDownloadBytes('drive', `${GOOGLE_BASE}/drive/v3/files/${encodeURIComponent(ref.driveFileId!)}?alt=media`, token);
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    return { ref, ok: false, output: '', error: `A Drive fajl tul nagy az azonnali feldolgozashoz (${bytes.length} byte). Toltsd le vagy valassz kisebb fajlt.` };
  }
  if ((ref.mimeType ?? '').startsWith('image/')) {
    const textBlock = `### Google Drive image: ${ref.label}\nThe image is attached below - analyze its visual contents.`;
    return { ref, ok: true, output: `OK ${ref.label}: image downloaded for vision`, textBlock, imageBlocks: [{ type: 'image_url', image_url: { url: bytesToDataUrl(bytes, ref.mimeType!) } }] };
  }

  const path = tempPathFor(ref);
  await invoke<string>('file_write_bytes', { path, bytes: Array.from(bytes) });
  try {
    const localRef: DocumentReference = { ...ref, id: `${ref.id}-download`, kind: 'file', path, source: 'connection' };
    const result = await readDocument(localRef);
    const body = result.contentText ?? (result.structured ? JSON.stringify(result.structured) : '') ?? result.summary ?? '';
    return {
      ref: { ...ref, resolvedContentSummary: body.slice(0, 700) },
      ok: result.ok,
      output: summarizeReadResults([result]),
      textBlock: `### Google Drive file: ${ref.label}\n${body || result.error || '[empty]'}`,
      error: result.ok ? undefined : result.error,
      documentRead: result,
    };
  } finally {
    await invoke<string>('fs_delete', { path, recursive: false }).catch(() => undefined);
  }
}

export async function resolveGoogleDriveReference(ref: DocumentReference, userId: string): Promise<DriveResolvedReference> {
  const token = await tokenForGoogle(userId);
  const fileId = ref.driveFileId ?? ref.path ?? ref.id.replace(/^drive-/, '');
  try {
    const metadata = await getDriveMetadata(token, fileId);
    const fullRef: DocumentReference = {
      ...ref,
      id: ref.id || `drive-${metadata.id}`,
      label: ref.label || metadata.name,
      kind: kindFor(metadata),
      driveFileId: metadata.id,
      url: metadata.webViewLink,
      webViewLink: metadata.webViewLink,
      mimeType: metadata.mimeType,
      lastModified: metadata.modifiedTime,
      owner: ownerOf(metadata),
      source: 'connection',
    };
    if (metadata.mimeType === DRIVE_FOLDER_MIME) return readDriveFolder(token, fullRef);
    if (metadata.mimeType === GOOGLE_DOC_MIME) return readGoogleDoc(token, fullRef);
    if (metadata.mimeType === GOOGLE_SHEET_MIME) return readGoogleSheet(token, fullRef);
    if (metadata.mimeType === GOOGLE_SLIDES_MIME) return readGoogleSlides(token, fullRef);
    return readDownloadedDriveFile(token, fullRef);
  } catch (error) {
    const mapped = mapGoogleError(error);
    return { ref, ok: false, output: '', error: mapped.error ?? String(error) };
  }
}
