import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { driveDownloadBytes } from './drive';
import { invoke } from '@tauri-apps/api/core';

const mockDocs = new Map<string, string>();

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

async function googleFetch(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://docs.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_docs_api_${res.status}: ${text}`);
  return text ? JSON.parse(text) as unknown : {};
}

function extractGoogleDocText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('textRun' in value) {
      const textRun = (value as { textRun?: { content?: string } }).textRun;
      if (textRun?.content) parts.push(textRun.content);
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  };
  walk(doc);
  return parts.join('').trim();
}

function extractInsertTextRequests(requests: unknown): string {
  if (!Array.isArray(requests)) return '';
  return requests
    .map((request) => (request as { insertText?: { text?: unknown } })?.insertText?.text)
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

export const googleDocsTools: ConnectionToolDefinition[] = [
  {
    name: 'google.docs.create',
    description: 'Create a Google Doc.',
    risk: 'external_write',
    async run(args, secrets) {
      if (isMock(args)) {
        const documentId = id('doc');
        mockDocs.set(documentId, '');
        return { success: true, output: `Mock Google Doc created: ${documentId}`, details: { documentId, url: `https://docs.google.com/document/d/${documentId}` } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch('/v1/documents', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ title: String(args.title ?? 'Larund Doc') }),
      });
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.docs.insert_text',
    description: 'Insert text into a Google Doc.',
    risk: 'external_write',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? '');
      const text = String(args.text ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      if (isMock(args)) {
        mockDocs.set(documentId, `${mockDocs.get(documentId) ?? ''}${text}`);
        return { success: true, output: `Mock inserted ${text.length} chars into ${documentId}`, details: { documentId, charCount: text.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v1/documents/${documentId}:batchUpdate`, auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
      });
      return { success: true, output: `Inserted ${text.length} chars into Google Doc ${documentId}`, details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.docs.batch_update',
    description: 'Run a Google Docs batchUpdate request.',
    risk: 'external_write',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      if (isMock(args)) {
        const text = extractInsertTextRequests(args.requests);
        if (text) mockDocs.set(documentId, `${mockDocs.get(documentId) ?? ''}${text}`);
        return { success: true, output: `Mock batch_update for ${documentId}`, details: { documentId, insertedChars: text.length } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v1/documents/${documentId}:batchUpdate`, auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ requests: args.requests ?? [] }),
      });
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.docs.read',
    description: 'Read a Google Doc.',
    risk: 'external_read',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      if (isMock(args)) return { success: true, output: mockDocs.get(documentId) ?? '', details: { documentId } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v1/documents/${documentId}`, auth.accessToken);
      const text = extractGoogleDocText(data);
      return { success: true, output: text || JSON.stringify(data), details: { ...(data as Record<string, unknown>), text } };
    },
  },
  {
    name: 'google.docs.get_metadata',
    description: 'Read Google Doc metadata.',
    risk: 'external_read',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      if (isMock(args)) return { success: true, output: JSON.stringify({ documentId, title: 'Mock Google Doc' }), details: { documentId } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const data = await googleFetch(`/v1/documents/${documentId}`, auth.accessToken);
      const doc = data as { title?: string; documentId?: string; revisionId?: string };
      const metadata = { documentId: doc.documentId ?? documentId, title: doc.title, revisionId: doc.revisionId };
      return { success: true, output: JSON.stringify(metadata), details: metadata };
    },
  },
  {
    name: 'google.docs.export_docx',
    description: 'Export a Google Doc to docx through Drive.',
    risk: 'external_read',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? args.fileId ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      const targetPath = String(args.targetPath ?? args.target_path ?? '');
      if (isMock(args)) {
        if (targetPath) await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(new TextEncoder().encode('mock docx export')) });
        return { success: true, output: targetPath ? `Mock exported docx to ${targetPath}` : 'Mock exported docx', details: { documentId, targetPath } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const mime = encodeURIComponent('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const bytes = await driveDownloadBytes(`/drive/v3/files/${documentId}/export?mimeType=${mime}`, auth.accessToken);
      if (targetPath) {
        const msg = await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(bytes) });
        return { success: true, output: msg, details: { documentId, targetPath, bytes: bytes.length } };
      }
      return { success: true, output: `Exported Google Doc ${documentId} as DOCX (${bytes.length} bytes)`, details: { documentId, bytes: bytes.length } };
    },
  },
  {
    name: 'google.docs.export_pdf',
    description: 'Export a Google Doc to PDF through Drive.',
    risk: 'external_read',
    async run(args, secrets) {
      const documentId = String(args.documentId ?? args.document_id ?? args.fileId ?? '');
      if (!documentId) return { success: false, output: '', error: 'missing_document_id' };
      const targetPath = String(args.targetPath ?? args.target_path ?? '');
      if (isMock(args)) {
        if (targetPath) await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(new TextEncoder().encode('mock pdf export')) });
        return { success: true, output: targetPath ? `Mock exported pdf to ${targetPath}` : 'Mock exported pdf', details: { documentId, targetPath } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const bytes = await driveDownloadBytes(`/drive/v3/files/${documentId}/export?mimeType=application%2Fpdf`, auth.accessToken);
      if (targetPath) {
        const msg = await invoke<string>('file_write_bytes', { path: targetPath, bytes: Array.from(bytes) });
        return { success: true, output: msg, details: { documentId, targetPath, bytes: bytes.length } };
      }
      return { success: true, output: `Exported Google Doc ${documentId} as PDF (${bytes.length} bytes)`, details: { documentId, bytes: bytes.length } };
    },
  },
];
