import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';

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
      if (isMock(args)) return { success: true, output: `Mock batch_update for ${documentId}`, details: { documentId } };
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
      return { success: true, output: JSON.stringify(data), details: data as Record<string, unknown> };
    },
  },
  {
    name: 'google.docs.get_metadata',
    description: 'Read Google Doc metadata.',
    risk: 'external_read',
    async run(args) {
      const documentId = String(args.documentId ?? args.document_id ?? '');
      return documentId ? { success: true, output: JSON.stringify({ documentId }) } : { success: false, output: '', error: 'missing_document_id' };
    },
  },
  {
    name: 'google.docs.export_docx',
    description: 'Export a Google Doc to docx through Drive.',
    risk: 'external_read',
    async run(args) {
      return { success: false, output: '', error: 'google_docs_export_docx_requires_drive_download_export', details: { args } };
    },
  },
  {
    name: 'google.docs.export_pdf',
    description: 'Export a Google Doc to PDF through Drive.',
    risk: 'external_read',
    async run(args) {
      return { success: false, output: '', error: 'google_docs_export_pdf_requires_drive_download_export', details: { args } };
    },
  },
];
