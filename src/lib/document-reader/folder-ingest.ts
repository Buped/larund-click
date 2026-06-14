import type { DocumentReference } from '../references/types';
import { readManyDocuments } from './readers';
import {
  DEFAULT_DOCUMENT_LIMITS,
  type DocumentReadOptions,
  type FileMetadata,
  type FolderInventoryEntry,
  type FolderScanResult,
  type ReadDocumentResult,
} from './types';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build']);
const RELEVANT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.xlsx', '.xls', '.ods', '.docx', '.doc', '.pdf']);

function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function joinPath(parent: string, child: string): string {
  if (/^[a-z]:[\\/]/i.test(child) || child.startsWith('/') || child.startsWith('\\')) return child;
  return parent.replace(/[\\/]+$/, '') + '\\' + child;
}

function label(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export async function scanFolder(ref: DocumentReference, options: DocumentReadOptions = {}): Promise<FolderScanResult> {
  const io = options.io;
  if (!io) {
    const { getDefaultDocumentIO } = await import('./readers');
    return scanFolder(ref, { ...options, io: getDefaultDocumentIO() });
  }
  const fs = io;
  const limits = { ...DEFAULT_DOCUMENT_LIMITS, ...options.limits };
  const root = ref.path;
  if (!root) {
    return { ref, ok: false, entries: [], groups: {}, metadata: { totalEntries: 0, truncated: false, maxEntries: limits.maxFolderEntries }, error: 'missing_folder_path' };
  }

  const entries: FolderInventoryEntry[] = [];
  let truncated = false;

  async function walk(path: string, depth: number): Promise<void> {
    if (entries.length >= limits.maxFolderEntries) {
      truncated = true;
      return;
    }
    if (depth > limits.maxDepth) return;
    const names = await fs.listDir(path);
    for (const name of names) {
      if (entries.length >= limits.maxFolderEntries) {
        truncated = true;
        return;
      }
      const child = joinPath(path, name);
      const meta: FileMetadata = await fs.metadata(child).catch(() => ({}));
      const itemLabel = label(child);
      if (meta.isDir) {
        entries.push({ path: child, label: itemLabel, kind: 'folder', sizeBytes: meta.sizeBytes, modifiedAt: meta.modifiedAt });
        if (!SKIP_DIRS.has(itemLabel)) await walk(child, depth + 1);
      } else {
        entries.push({
          path: child,
          label: itemLabel,
          kind: 'file',
          extension: extOf(child),
          sizeBytes: meta.sizeBytes,
          modifiedAt: meta.modifiedAt,
        });
      }
    }
  }

  try {
    await walk(root, 0);
    const groups = entries.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.kind === 'folder' ? 'folder' : entry.extension || 'no_ext';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return {
      ref,
      ok: true,
      entries,
      groups,
      metadata: { totalEntries: entries.length, truncated, maxEntries: limits.maxFolderEntries },
    };
  } catch (error) {
    return { ref, ok: false, entries, groups: {}, metadata: { totalEntries: entries.length, truncated, maxEntries: limits.maxFolderEntries }, error: String(error) };
  }
}

export async function readRelevantFromFolder(
  ref: DocumentReference,
  query = '',
  options: DocumentReadOptions = {},
): Promise<{ scan: FolderScanResult; documents: ReadDocumentResult[] }> {
  const scan = await scanFolder(ref, options);
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const files = scan.entries
    .filter((entry) => entry.kind === 'file')
    .filter((entry) => RELEVANT_EXT.has(entry.extension ?? '') || terms.some((term) => entry.label.toLowerCase().includes(term)))
    .slice(0, 20)
    .map<DocumentReference>((entry) => ({
      id: `folder-file-${entry.path}`,
      kind: 'file',
      label: entry.label,
      path: entry.path,
      source: 'tool_result',
    }));
  return { scan, documents: await readManyDocuments(files, options) };
}

export function formatFolderScan(scan: FolderScanResult): string {
  if (!scan.ok) return `Folder scan failed: ${scan.error ?? 'unknown error'}`;
  const groups = Object.entries(scan.groups).map(([k, v]) => `${k}:${v}`).join(', ');
  const sample = scan.entries.slice(0, 30).map((entry) => `${entry.kind === 'folder' ? '[dir]' : '[file]'} ${entry.path}`).join('\n');
  return `Folder scan OK. entries=${scan.metadata.totalEntries}, truncated=${scan.metadata.truncated}, groups=${groups}\n${sample}`;
}
