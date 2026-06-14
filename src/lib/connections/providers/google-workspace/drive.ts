import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';

async function driveFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_drive_api_${res.status}: ${text}`);
  return text ? JSON.parse(text) as unknown : {};
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
    async run(args) {
      if (args.mock === true) return { success: true, output: 'Mock Drive folder created', details: { folderId: `folder-${Date.now()}` } };
      return { success: false, output: '', error: 'drive_create_folder_not_wired_yet' };
    },
  },
  {
    name: 'google.drive.upload',
    description: 'Upload a local file to Drive.',
    risk: 'external_write',
    async run() {
      return { success: false, output: '', error: 'drive_upload_not_wired_yet' };
    },
  },
  {
    name: 'google.drive.download_export',
    description: 'Export/download a Drive file.',
    risk: 'external_read',
    async run() {
      return { success: false, output: '', error: 'drive_download_export_not_wired_yet' };
    },
  },
  {
    name: 'google.drive.move_file',
    description: 'Move a Drive file.',
    risk: 'external_write',
    async run() {
      return { success: false, output: '', error: 'drive_move_file_not_wired_yet' };
    },
  },
];
