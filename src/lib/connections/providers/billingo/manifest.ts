import type { ConnectionManifest } from '../../types';
import { billingoTools } from './tools';

export const billingoManifest: ConnectionManifest = {
  id: 'billingo',
  name: 'Billingo',
  description: 'Hungarian invoicing: list, read, create and download invoices with approval-gated writes.',
  auth: { type: 'api_key', envVars: ['BILLINGO_API_KEY'] },
  risk: 'external_send',
  tools: billingoTools,
};
