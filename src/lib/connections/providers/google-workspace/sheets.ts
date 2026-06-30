import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { driveDownloadBytes } from './drive';
import { GOOGLE_BASE, googleApiFetch, googleResult } from './client';
import { invoke } from '@tauri-apps/api/core';

const mockStore = new Map<string, string[][]>();

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

function normalizeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')]);
}

function googleFetch(path: string, token: string, init: RequestInit = {}) {
  return googleApiFetch('sheets', `${GOOGLE_BASE}${path}`, token, init);
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
      return googleResult(async () => {
        const data = await googleFetch('/v4/spreadsheets', auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ properties: { title } }),
        }) as { spreadsheetId?: string; spreadsheetUrl?: string };
        return { success: true, output: `Google Sheet created: ${data.spreadsheetUrl ?? data.spreadsheetId}`, details: data as Record<string, unknown> };
      });
    },
  },
  {
    name: 'google.sheets.batch_get_values',
    description: 'Read multiple ranges from a Google Sheet.',
    risk: 'external_read',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const ranges = (Array.isArray(args.ranges) ? args.ranges : [args.range ?? 'A1:Z1000']).map(String);
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (isMock(args)) {
        const values = mockStore.get(spreadsheetId) ?? [];
        const valueRanges = ranges.map((range) => ({ range, values }));
        return { success: true, output: JSON.stringify({ spreadsheetId, valueRanges }), details: { spreadsheetId, valueRanges } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&');
        const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
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
      return googleResult(async () => {
        await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, auth.accessToken!, {
          method: 'PUT',
          body: JSON.stringify({ values }),
        });
        // Automatic read-back: re-read the same range and compare row counts.
        const back = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, auth.accessToken!) as { values?: string[][] };
        const readRows = back.values?.length ?? 0;
        const verified = readRows >= values.length && values.length > 0;
        return {
          success: true,
          output: `Wrote ${values.length} rows to Google Sheet ${spreadsheetId}. Read-back: ${readRows} rows ${verified ? '✓ verified' : '⚠ mismatch'}.`,
          details: { spreadsheetId, range, wroteRows: values.length, readRows, verified, readBack: back.values },
        };
      });
    },
  },
  {
    name: 'google.sheets.batch_update_values',
    description: 'Write multiple value ranges to a Google Sheet and read them back.',
    risk: 'external_write',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const data = (Array.isArray(args.data) ? args.data : []) as Array<{ range?: string; values?: unknown }>;
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (!data.length) return { success: false, output: '', error: 'missing_batch_data' };
      const normalized = data.map((item) => ({ range: String(item.range ?? 'A1'), values: normalizeRows(item.values) }));
      if (isMock(args)) {
        mockStore.set(spreadsheetId, normalized[0]?.values ?? []);
        return { success: true, output: `Mock batch updated ${normalized.length} ranges`, details: { spreadsheetId, updatedRanges: normalized.map((d) => d.range), verified: true, readBack: normalized } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: normalized }),
        });
        const query = normalized.map((item) => `ranges=${encodeURIComponent(item.range)}`).join('&');
        const back = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}`, auth.accessToken!) as { valueRanges?: Array<{ range?: string; values?: string[][] }> };
        const verified = (back.valueRanges ?? []).length === normalized.length;
        return { success: true, output: `Batch updated ${normalized.length} ranges. Read-back: ${verified ? 'verified' : 'not verified'}.`, details: { spreadsheetId, updatedRanges: normalized.map((d) => d.range), verified, readBack: back.valueRanges } };
      });
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
      return googleResult(async () => {
        const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ values }),
        }) as { updates?: { updatedRange?: string; updatedRows?: number } };
        // Automatic read-back: re-read exactly the range the API reported writing to.
        const updatedRange = data.updates?.updatedRange ?? range;
        const back = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(updatedRange)}`, auth.accessToken!) as { values?: string[][] };
        const readRows = back.values?.length ?? 0;
        const verified = readRows >= values.length && values.length > 0;
        return {
          success: true,
          output: `Appended ${values.length} rows to Google Sheet ${spreadsheetId}. Read-back: ${readRows} rows ${verified ? '✓ verified' : '⚠ mismatch'}.`,
          details: { spreadsheetId, updatedRange, wroteRows: values.length, readRows, verified, readBack: back.values },
        };
      });
    },
  },
  {
    name: 'google.sheets.append_or_update_rows',
    description: 'Append rows or update a range when an updateRange is provided; always read back the affected range.',
    risk: 'external_write',
    async run(args, secrets) {
      const spreadsheetId = String(args.spreadsheetId ?? args.spreadsheet_id ?? '');
      const range = String(args.range ?? 'A1');
      const updateRange = String(args.updateRange ?? args.update_range ?? '');
      const values = normalizeRows(args.values ?? args.rows);
      if (!spreadsheetId) return { success: false, output: '', error: 'missing_spreadsheet_id' };
      if (!values.length) return { success: false, output: '', error: 'missing_rows' };
      if (isMock(args)) {
        const existing = mockStore.get(spreadsheetId) ?? [];
        const next = updateRange ? values : [...existing, ...values];
        mockStore.set(spreadsheetId, next);
        return { success: true, output: `Mock ${updateRange ? 'updated' : 'appended'} ${values.length} rows`, details: { spreadsheetId, range: updateRange || range, wroteRows: values.length, readRows: next.length, verified: true, readBack: next } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        let readRange = updateRange || range;
        if (updateRange) {
          await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`, auth.accessToken!, {
            method: 'PUT',
            body: JSON.stringify({ values }),
          });
        } else {
          const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, auth.accessToken!, {
            method: 'POST',
            body: JSON.stringify({ values }),
          }) as { updates?: { updatedRange?: string } };
          readRange = data.updates?.updatedRange ?? range;
        }
        const back = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(readRange)}`, auth.accessToken!) as { values?: string[][] };
        const readRows = back.values?.length ?? 0;
        const verified = readRows >= values.length;
        return { success: true, output: `${updateRange ? 'Updated' : 'Appended'} ${values.length} rows. Read-back: ${verified ? 'verified' : 'mismatch'}.`, details: { spreadsheetId, range: readRange, wroteRows: values.length, readRows, verified, readBack: back.values } };
      });
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
      return googleResult(async () => {
        const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
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
      return googleResult(async () => {
        const data = await googleFetch(`/v4/spreadsheets/${spreadsheetId}?includeGridData=false`, auth.accessToken!);
        return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
      });
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
      return googleResult(async () => {
        const mime = encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const bytes = await driveDownloadBytes(`/drive/v3/files/${spreadsheetId}/export?mimeType=${mime}`, auth.accessToken!);
        if (targetPath) {
          const msg = await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(bytes) });
          return { success: true, output: msg, details: { spreadsheetId, targetPath, bytes: bytes.length } };
        }
        return { success: true, output: `Exported Google Sheet ${spreadsheetId} (${bytes.length} bytes)`, details: { spreadsheetId, bytes: bytes.length } };
      });
    },
  },
];
