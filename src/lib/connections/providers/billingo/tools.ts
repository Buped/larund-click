import type { ConnectionCallResult, ConnectionToolDefinition } from '../../types';
import { mockOrMissingAuth } from '../../mock-guard';

const API = 'https://api.billingo.hu/v3';
const SETUP = 'Add a Billingo API v3 key in Connections -> Billingo.';

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}

function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}

function token(secrets: Record<string, string>): string {
  return secrets.BILLINGO_API_KEY || secrets.BILLINGO_TOKEN || secrets.BILLINGO_HU_TOKEN || '';
}

async function bFetch(path: string, apiKey: string, init?: RequestInit): Promise<ConnectionCallResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
        ...(init?.headers ?? {}),
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/pdf') ? await res.blob() : await res.text();
    if (!res.ok) return err(`billingo_${res.status}: ${typeof body === 'string' ? body.slice(0, 500) : 'PDF download failed'}`);
    if (typeof body !== 'string') return ok(`Downloaded Billingo PDF (${body.size} bytes).`, { bytes: body.size, contentType });
    return ok(body);
  } catch (e) {
    return err(`billingo_request_failed: ${String(e)}`);
  }
}

function qs(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') out.set(key, String(value));
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const billingoTools: ConnectionToolDefinition[] = [
  {
    name: 'billingo.test_connection',
    description: 'Verify the Billingo API key by reading organization data.',
    risk: 'external_read',
    async run(_args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.test_connection', 'billingo.test_connection', SETUP);
      const result = await bFetch('/organization', apiKey);
      if (!result.success) return result;
      return ok('Connected to Billingo.', { provider: 'billingo' });
    },
  },
  {
    name: 'billingo.list_invoices',
    description: 'List Billingo invoices/documents with optional date/status filters.',
    risk: 'external_read',
    async run(args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.list_invoices', 'billingo.list_invoices', SETUP);
      return bFetch(`/documents${qs({ page: args.page ?? 1, per_page: args.perPage ?? 25, block_id: args.blockId, start_date: args.startDate, end_date: args.endDate, payment_status: args.status })}`, apiKey);
    },
  },
  {
    name: 'billingo.get_invoice',
    description: 'Retrieve one Billingo invoice/document by id.',
    risk: 'external_read',
    async run(args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.get_invoice', `billingo.get_invoice ${str(args.id)}`, SETUP);
      return bFetch(`/documents/${str(args.id)}`, apiKey);
    },
  },
  {
    name: 'billingo.create_invoice',
    description: 'Create a Billingo invoice. Approval is required by policy.',
    risk: 'external_send',
    async run(args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.create_invoice', 'billingo.create_invoice', SETUP);
      const result = await bFetch('/documents', apiKey, { method: 'POST', body: JSON.stringify(args.document ?? args) });
      if (!result.success) return result;
      return ok(`Billingo invoice created. Read back the returned document before using it.\n${result.output}`, { provider: 'billingo', readBackRequired: true });
    },
  },
  {
    name: 'billingo.download_invoice_pdf',
    description: 'Download a Billingo invoice PDF by document id.',
    risk: 'external_read',
    async run(args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.download_invoice_pdf', `billingo.download_invoice_pdf ${str(args.id)}`, SETUP);
      return bFetch(`/documents/${str(args.id)}/download`, apiKey, { headers: { Accept: 'application/pdf' } });
    },
  },
  {
    name: 'billingo.mark_invoice_paid',
    description: 'Update Billingo payment history for a document. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const apiKey = token(secrets);
      if (!apiKey) return mockOrMissingAuth('Billingo', 'billingo.mark_invoice_paid', `billingo.mark_invoice_paid ${str(args.id)}`, SETUP);
      return bFetch(`/documents/${str(args.id)}/payments`, apiKey, {
        method: 'PUT',
        body: JSON.stringify(args.payment ?? { payment_date: args.paymentDate, payment_method: args.paymentMethod ?? 'bankcard', amount: args.amount }),
      });
    },
  },
];
