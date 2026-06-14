import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { invoke } from '@tauri-apps/api/core';

export async function driveFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_drive_api_${res.status}: ${text}`);
  return text ? JSON.parse(text) as unknown : {};
}

export async function driveDownloadBytes(path: string, token: string): Promise<Uint8Array> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google_drive_download_${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
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
      const q = encodeURIComponent(String(args.q ?? args.query ?? 'trashed=false'));
      const data = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink)`, auth.accessToken);
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
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
      const data = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,size,modifiedTime`, auth.accessToken);
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.drive.create_folder',
    description: 'Create a Drive folder.',
    risk: 'external_write',
    async run(args, secrets) {
      if (args.mock === true) return { success: true, output: 'Mock Drive folder created', details: { folderId: `folder-${Date.now()}` } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const metadata: Record<string, unknown> = {
        name: String(args.name ?? 'Larund Folder'),
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (args.parentId) metadata.parents = [String(args.parentId)];
      const data = await driveFetch('/drive/v3/files?fields=id,name,webViewLink', auth.accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      });
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.drive.upload',
    description: 'Upload a local file to Drive.',
    risk: 'external_write',
    async run(args, secrets) {
      if (args.mock === true) return { success: true, output: 'Mock Drive upload complete', details: { fileId: `file-${Date.now()}` } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const path = String(args.path ?? '');
      if (!path) return { success: false, output: '', error: 'missing_upload_path' };
      const name = String(args.name ?? path.split(/[\\/]/).pop() ?? 'upload.bin');
      const bytes = await invoke<number[]>('file_read_bytes', { path });
      const metadata: Record<string, unknown> = { name };
      if (args.parentId) metadata.parents = [String(args.parentId)];
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([new Uint8Array(bytes)]), name);
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        body: form,
      });
      const text = await res.text();
      if (!res.ok) return { success: false, output: '', error: `drive_upload_failed:${res.status}: ${text}` };
      return { success: true, output: text, details: JSON.parse(text) as Record<string, unknown> };
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
      const mimeType = encodeURIComponent(String(args.mimeType ?? args.mime_type ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
      const bytes = await driveDownloadBytes(`/drive/v3/files/${fileId}/export?mimeType=${mimeType}`, auth.accessToken);
      if (targetPath) {
        const msg = await writeBytes(targetPath, bytes);
        return { success: true, output: msg, details: { fileId, targetPath, bytes: bytes.length } };
      }
      return { success: true, output: `Downloaded ${bytes.length} bytes from Drive export`, details: { fileId, bytes: bytes.length } };
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
      const meta = await driveFetch(`/drive/v3/files/${fileId}?fields=parents`, auth.accessToken) as { parents?: string[] };
      const removeParents = encodeURIComponent((meta.parents ?? []).join(','));
      const data = await driveFetch(`/drive/v3/files/${fileId}?addParents=${encodeURIComponent(folderId)}&removeParents=${removeParents}&fields=id,parents,webViewLink`, auth.accessToken, {
        method: 'PATCH',
      });
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
];
