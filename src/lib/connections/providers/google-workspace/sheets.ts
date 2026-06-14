import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { driveDownloadBytes } from './drive';
import { invoke } from '@tauri-apps/api/core';

const mockStore = new Map<string, string[][]>();

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

async function googleFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_api_${res.status}: ${text}`);
  return text ? JSON.parse(text) as unknown : {};
}

export const googleSheetsTools: ConnectionToolDefinition[] = [
  {
    name: 'google.sheets.create',
    description: 'Create a Google Sheet through the Sheets API.',
    risk: 'external_write',
    async run(args, secrets) {
      if (isMock(args)) {
        const spreadsheetId = id('sheet');
        mockStore.set(spreadsheetId, []);
        return { success: true, output: `Mock Google Sheet created: ${spreadsheetId}`, details: { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const title = String(args.title ?? 'Larund Sheet');
      const data = await googleFetch('/v4/spreadsheets', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ properties: { title } }),
      }) as { spreadsheetId?: string; spreadsheetUrl?: string };
      return { success: true, output: `Google Sheet created: ${data.spreadsheetUrl ?? data.spreadsheetId}`, details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.sheets.write_values',
    description: 'Write values to a Google Sheet range.',
    risk: 'external_write',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const range = String(args.range ?? 'A1');
      const values = (args.values ?? args.rows ?? []) as string[][];
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (isMock(args)) {
        mockStore.set(spreadsheetId, values);
        return { success: true, output: `Mock wrote ${values.length} rows to ${spreadsheetId}!${range}`, details: { spreadsheetId, range, rowCount: values.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, auth.accessToken, {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
      return { success: true, output: `Wrote ${values.length} rows to Google Sheet ${spreadsheetId}`, details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.sheets.append_values',
    description: 'Append values to a Google Sheet range.',
    risk: 'external_write',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const range = String(args.range ?? 'A1');
      const values = (args.values ?? args.rows ?? []) as string[][];
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (isMock(args)) {
        const existing = mockStore.get(spreadsheetId) ?? [];
        mockStore.set(spreadsheetId, [...existing, ...values]);
        return { success: true, output: `Mock appended ${values.length} rows to ${spreadsheetId}`, details: { spreadsheetId, rowCount: existing.length + values.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ values }),
      });
      return { success: true, output: `Appended ${values.length} rows to Google Sheet ${spreadsheetId}`, details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.sheets.read_values',
    description: 'Read values from a Google Sheet range.',
    risk: 'external_read',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const range = String(args.range ?? 'A1:Z1000');
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (isMock(args)) {
        const values = mockStore.get(spreadsheetId) ?? [];
        return { success: true, output: JSON.stringify({ spreadsheetId, range, values, rowCount: values.length }), details: { spreadsheetId, range, values, rowCount: values.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, auth.accessToken);
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.sheets.get_metadata',
    description: 'Read Google Sheet metadata.',
    risk: 'external_read',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (isMock(args)) return { success: true, output: JSON.stringify({ spreadsheetId, sheets: [{ properties: { title: 'Sheet1' } }] }) };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}?includeGridData=false`, auth.accessToken);
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.sheets.export_xlsx',
    description: 'Export a Google Sheet as xlsx through Drive export.',
    risk: 'external_read',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? args.fileId ?? '');
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      const targetPath = String(args.targetPath ?? args.target_path ?? '');
      if (isMock(args)) {
        if (targetPath) await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(new TextEncoder().encode('mock xlsx export')) });
        return { success: true, output: targetPath ? `Mock exported sheet to ${targetPath}` : 'Mock exported sheet', details: { spreadsheetId, targetPath } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const mime = encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const bytes = await driveDownloadBytes(`/drive/v3/files/${spreadsheetId}/export?mimeType=${mime}`, auth.accessToken);
      if (targetPath) {
        const msg = await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(bytes) });
        return { success: true, output: msg, details: { spreadsheetId, targetPath, bytes: bytes.length } };
      }
      return { success: true, output: `Exported Google Sheet ${spreadsheetId} (${bytes.length} bytes)`, details: { spreadsheetId, bytes: bytes.length } };
    },
  },
];
