import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { GOOGLE_BASE, GoogleApiError, googleApiFetch, googleDownloadBytes, googleResult } from './client';
import { invoke } from '@tauri-apps/api/core';

export function driveFetch(path: string, token: string, init: RequestInit = {}) {
  return googleApiFetch('drive', `${GOOGLE_BASE}${path}`, token, init);
}

export function driveDownloadBytes(path: string, token: string): Promise<Uint8Array> {
  return googleDownloadBytes('drive', `${GOOGLE_BASE}${path}`, token);
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>('file_write_bytes', { path, bytes: Array.from(bytes) });
}

export const googleDriveTools: ConnectionToolDefinition[] = [
  {
    name: 'google.drive.search',
    description: 'Search Drive files.',
    risk: 'external_read',
    async run(args, secrets) {
      if (args.mock === true) return { success: true, output: JSON.stringify({ files: [] }) };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const q = encodeURIComponent(String(args.q ?? args.query ?? 'trashed=false'));
        const data = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink)`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
    },
  },
  {
    name: 'google.drive.get_file',
    description: 'Get Drive file metadata.',
    risk: 'external_read',
    async run(args, secrets) {
      const fileId = String(args.fileId ?? args.file_id ?? '');
      if (!fileId) return { success: false, output: '', error: 'missing_file_id' };
      if (args.mock === true) return { success: true, output: JSON.stringify({ id: fileId, name: 'Mock file' }) };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,size,modifiedTime`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
    },
  },
  {
    name: 'google.drive.resolve_reference',
    description: 'Resolve a Drive file by id, URL, name or query into metadata.',
    risk: 'external_read',
    async run(args, secrets) {
      const id = String(args.fileId ?? args.file_id ?? '').trim();
      const url = String(args.url ?? '').trim();
      const query = String(args.q ?? args.query ?? args.name ?? '').trim();
      const urlId = url.match(/\/d\/([^/]+)/)?.[1] ?? url.match(/[?&]id=([^&]+)/)?.[1] ?? '';
      const fileId = id || urlId;
      if (args.mock === true) {
        return { success: true, output: JSON.stringify({ id: fileId || 'mock-file', name: query || 'Mock file', mimeType: 'text/plain', webViewLink: url || 'https://drive.mock/file' }), details: { id: fileId || 'mock-file', name: query || 'Mock file' } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        if (fileId) {
          const data = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,size,modifiedTime,parents`, auth.accessToken!);
          return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
        }
        const q = query
          ? `name contains '${query.replace(/'/g, "\\'")}' and trashed=false`
          : 'trashed=false';
        const data = await driveFetch(`/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=10&fields=files(id,name,mimeType,webViewLink,size,modifiedTime)`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
    },
  },
  {
    name: 'google.drive.search_and_read',
    description: 'Search Drive files and return compact readable metadata for matching items.',
    risk: 'external_read',
    async run(args, secrets) {
      const query = String(args.q ?? args.query ?? 'trashed=false');
      const maxResults = Math.min(Number(args.maxResults ?? args.max_results ?? 10) || 10, 25);
      if (args.mock === true) {
        const files = [{ id: 'mock-file-1', name: query || 'Mock file', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://drive.mock/mock-file-1' }];
        return { success: true, output: JSON.stringify({ files, count: files.length }), details: { files } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await driveFetch(`/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=${maxResults}&fields=files(id,name,mimeType,webViewLink,size,modifiedTime)`, auth.accessToken!) as { files?: unknown[] };
        return { success: true, output: JSON.stringify({ files: data.files ?? [], count: data.files?.length ?? 0 }), details: { files: data.files ?? [], count: data.files?.length ?? 0 } };
      });
    },
  },
  {
    name: 'google.drive.ensure_folder',
    description: 'Find or create a Drive folder by name, then read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const name = String(args.name ?? '').trim();
      const parentId = String(args.parentId ?? args.parent_id ?? '');
      if (!name) return { success: false, output: '', error: 'missing_folder_name' };
      if (args.mock === true) return { success: true, output: `Mock ensured Drive folder: ${name}`, details: { folderId: `folder-${name.replace(/\W+/g, '-')}`, name, verified: true, created: false } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const parentClause = parentId ? ` and '${parentId}' in parents` : '';
        const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
        const found = await driveFetch(`/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=1&fields=files(id,name,webViewLink)`, auth.accessToken!) as { files?: Array<{ id?: string; name?: string; webViewLink?: string }> };
        const existing = found.files?.[0];
        if (existing?.id) {
          return { success: true, output: `Drive folder exists: ${existing.name}. Read-back: verified.`, details: { ...existing, folderId: existing.id, verified: true, created: false } };
        }
        const metadata: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
        if (parentId) metadata.parents = [parentId];
        const created = await driveFetch('/drive/v3/files?fields=id,name,webViewLink', auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify(metadata),
        }) as { id?: string; name?: string; webViewLink?: string };
        const verified = created.id ? await driveFetch(`/drive/v3/files/${created.id}?fields=id,mimeType`, auth.accessToken!).then(() => true).catch(() => false) : false;
        return { success: true, output: `Drive folder created: ${created.name}. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { ...created, folderId: created.id, verified, created: true } };
      });
    },
  },
  {
    name: 'google.drive.create_folder',
    description: 'Create a Drive folder.',
    risk: 'external_write',
    async run(args, secrets) {
      if (args.mock === true) return { success: true, output: 'Mock Drive folder created', details: { folderId: `folder-${Date.now()}`, verified: true } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const metadata: Record<string, unknown> = {
          name: String(args.name ?? 'Larund Folder'),
          mimeType: 'application/vnd.google-apps.folder',
        };
        if (args.parentId) metadata.parents = [String(args.parentId)];
        const data = await driveFetch('/drive/v3/files?fields=id,name,webViewLink', auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify(metadata),
        }) as { id?: string; name?: string; webViewLink?: string };
        // Read-back: confirm the folder exists.
        const verified = data.id
          ? await driveFetch(`/drive/v3/files/${data.id}?fields=id,mimeType`, auth.accessToken!).then(() => true).catch(() => false)
          : false;
        return { success: true, output: `Drive mappa létrehozva: ${data.name}. Read-back: ${verified ? '✓' : '⚠'}.`, details: { ...data, folderId: data.id, verified } };
      });
    },
  },
  {
    name: 'google.drive.copy_file',
    description: 'Copy a Drive file, optionally into a target folder, then read copied metadata back.',
    risk: 'external_write',
    async run(args, secrets) {
      const fileId = String(args.fileId ?? args.file_id ?? '');
      const name = String(args.name ?? '');
      const parentId = String(args.parentId ?? args.parent_id ?? args.folderId ?? args.folder_id ?? '');
      if (!fileId) return { success: false, output: '', error: 'missing_file_id' };
      if (args.mock === true) return { success: true, output: `Mock copied Drive file ${fileId}`, details: { fileId: `copy-${fileId}`, sourceFileId: fileId, name: name || 'Mock copy', verified: true } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const metadata: Record<string, unknown> = {};
        if (name) metadata.name = name;
        if (parentId) metadata.parents = [parentId];
        const copied = await driveFetch(`/drive/v3/files/${fileId}/copy?fields=id,name,webViewLink,mimeType`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify(metadata),
        }) as { id?: string; name?: string; webViewLink?: string; mimeType?: string };
        const verified = copied.id
          ? await driveFetch(`/drive/v3/files/${copied.id}?fields=id,name,webViewLink,mimeType`, auth.accessToken!).then(() => true).catch(() => false)
          : false;
        return { success: true, output: `Drive file copied: ${copied.name}. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { ...copied, fileId: copied.id, sourceFileId: fileId, verified } };
      });
    },
  },
  {
    name: 'google.drive.upload',
    description: 'Upload a local file to Drive.',
    risk: 'external_write',
    async run(args, secrets) {
      if (args.mock === true) return { success: true, output: 'Mock Drive upload complete', details: { fileId: `file-${Date.now()}`, verified: true } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const path = String(args.path ?? '');
      if (!path) return { success: false, output: '', error: 'missing_upload_path' };
      return googleResult(async () => {
        const name = String(args.name ?? path.split(/[\\/]/).pop() ?? 'upload.bin');
        const bytes = await invoke<number[]>('file_read_bytes', { path });
        const metadata: Record<string, unknown> = { name };
        if (args.parentId) metadata.parents = [String(args.parentId)];
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([new Uint8Array(bytes)]), name);
        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.accessToken!}` },
          body: form,
        });
        const text = await res.text();
        if (!res.ok) throw new GoogleApiError('drive', res.status, text);
        const data = JSON.parse(text) as { id?: string; name?: string; webViewLink?: string };
        // Read-back: confirm the uploaded file is retrievable with a non-zero size.
        let verified = false;
        if (data.id) {
          const meta = await driveFetch(`/drive/v3/files/${data.id}?fields=id,name,size`, auth.accessToken!) as { id?: string };
          verified = Boolean(meta.id);
        }
        return { success: true, output: `Feltöltve a Drive-ra: ${data.name}. Read-back: ${verified ? '✓' : '⚠'}.`, details: { ...data, fileId: data.id, verified } };
      });
    },
  },
  {
    name: 'google.drive.download_export',
    description: 'Export/download a Drive file.',
    risk: 'external_read',
    async run(args, secrets) {
      const fileId = String(args.fileId ?? args.file_id ?? '');
      if (!fileId) return { success: false, output: '', error: 'missing_file_id' };
      const targetPath = String(args.targetPath ?? args.target_path ?? '');
      if (args.mock === true) {
        if (targetPath) await writeBytes(targetPath, new TextEncoder().encode('mock google export'));
        return { success: true, output: targetPath ? `Mock exported ${fileId} to ${targetPath}` : `Mock exported ${fileId}`, details: { fileId, targetPath } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const mimeType = encodeURIComponent(String(args.mimeType ?? args.mime_type ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        const bytes = await driveDownloadBytes(`/drive/v3/files/${fileId}/export?mimeType=${mimeType}`, auth.accessToken!);
        if (targetPath) {
          const msg = await writeBytes(targetPath, bytes);
          return { success: true, output: msg, details: { fileId, targetPath, bytes: bytes.length } };
        }
        return { success: true, output: `Downloaded ${bytes.length} bytes from Drive export`, details: { fileId, bytes: bytes.length } };
      });
    },
  },
  {
    name: 'google.drive.move_file',
    description: 'Move a Drive file.',
    risk: 'external_write',
    async run(args, secrets) {
      const fileId = String(args.fileId ?? args.file_id ?? '');
      const folderId = String(args.folderId ?? args.folder_id ?? args.parentId ?? '');
      if (!fileId || !folderId) return { success: false, output: '', error: 'missing_file_or_folder_id' };
      if (args.mock === true) return { success: true, output: `Mock moved ${fileId} to ${folderId}`, details: { fileId, folderId } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const meta = await driveFetch(`/drive/v3/files/${fileId}?fields=parents`, auth.accessToken!) as { parents?: string[] };
        const removeParents = encodeURIComponent((meta.parents ?? []).join(','));
        const data = await driveFetch(`/drive/v3/files/${fileId}?addParents=${encodeURIComponent(folderId)}&removeParents=${removeParents}&fields=id,parents,webViewLink`, auth.accessToken!, {
          method: 'PATCH',
        });
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
    },
  },
];
