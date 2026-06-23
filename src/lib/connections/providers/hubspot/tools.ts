import type { ConnectionCallResult, ConnectionToolDefinition } from '../../types';
import { mockOrMissingAuth } from '../../mock-guard';

const API = 'https://api.hubapi.com';
const SETUP = 'Add a HubSpot private app token in Connections -> HubSpot.';

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}
function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}
function token(secrets: Record<string, string>): string {
  return secrets.HUBSPOT_PRIVATE_APP_TOKEN || secrets.HUBSPOT_TOKEN || '';
}
async function hsFetch(path: string, accessToken: string, init?: RequestInit): Promise<ConnectionCallResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) return err(`hubspot_${res.status}: ${text.slice(0, 500)}`);
    return ok(text);
  } catch (e) {
    return err(`hubspot_request_failed: ${String(e)}`);
  }
}
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export const hubspotTools: ConnectionToolDefinition[] = [
  {
    name: 'hubspot.test_connection',
    description: 'Verify the HubSpot token by reading account metadata.',
    risk: 'external_read',
    async run(_args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.test_connection', 'hubspot.test_connection', SETUP);
      const result = await hsFetch('/account-info/v3/details', accessToken);
      return result.success ? ok('Connected to HubSpot.', { provider: 'hubspot' }) : result;
    },
  },
  {
    name: 'hubspot.search_contacts',
    description: 'Search HubSpot contacts.',
    risk: 'external_read',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.search_contacts', 'hubspot.search_contacts', SETUP);
      return hsFetch('/crm/v3/objects/contacts/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(args.search ?? { query: str(args.query), limit: args.limit ?? 10 }),
      });
    },
  },
  {
    name: 'hubspot.get_contact',
    description: 'Get one HubSpot contact.',
    risk: 'external_read',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.get_contact', `hubspot.get_contact ${str(args.id)}`, SETUP);
      return hsFetch(`/crm/v3/objects/contacts/${str(args.id)}?properties=${encodeURIComponent(str(args.properties) || 'email,firstname,lastname,phone,company')}`, accessToken);
    },
  },
  {
    name: 'hubspot.create_contact',
    description: 'Create a HubSpot contact. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.create_contact', 'hubspot.create_contact', SETUP);
      return hsFetch('/crm/v3/objects/contacts', accessToken, { method: 'POST', body: JSON.stringify({ properties: args.properties ?? args.contact ?? args }) });
    },
  },
  {
    name: 'hubspot.update_contact',
    description: 'Update a HubSpot contact.',
    risk: 'external_write',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.update_contact', `hubspot.update_contact ${str(args.id)}`, SETUP);
      return hsFetch(`/crm/v3/objects/contacts/${str(args.id)}`, accessToken, { method: 'PATCH', body: JSON.stringify({ properties: args.properties ?? args.contact }) });
    },
  },
  {
    name: 'hubspot.list_deals',
    description: 'List/search HubSpot deals.',
    risk: 'external_read',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.list_deals', 'hubspot.list_deals', SETUP);
      if (args.search) return hsFetch('/crm/v3/objects/deals/search', accessToken, { method: 'POST', body: JSON.stringify(args.search) });
      return hsFetch(`/crm/v3/objects/deals?limit=${encodeURIComponent(str(args.limit) || '20')}&properties=dealname,amount,dealstage,pipeline,closedate`, accessToken);
    },
  },
  {
    name: 'hubspot.create_deal',
    description: 'Create a HubSpot deal. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.create_deal', 'hubspot.create_deal', SETUP);
      return hsFetch('/crm/v3/objects/deals', accessToken, { method: 'POST', body: JSON.stringify({ properties: args.properties ?? args.deal ?? args }) });
    },
  },
  {
    name: 'hubspot.update_deal_stage',
    description: 'Update a HubSpot deal stage. Approval is required by policy.',
    risk: 'external_write',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.update_deal_stage', `hubspot.update_deal_stage ${str(args.id)}`, SETUP);
      return hsFetch(`/crm/v3/objects/deals/${str(args.id)}`, accessToken, { method: 'PATCH', body: JSON.stringify({ properties: { dealstage: str(args.stageId ?? args.dealstage) } }) });
    },
  },
  {
    name: 'hubspot.create_task',
    description: 'Create a HubSpot CRM task.',
    risk: 'external_write',
    async run(args, secrets) {
      const accessToken = token(secrets);
      if (!accessToken) return mockOrMissingAuth('HubSpot', 'hubspot.create_task', 'hubspot.create_task', SETUP);
      return hsFetch('/crm/v3/objects/tasks', accessToken, { method: 'POST', body: JSON.stringify({ properties: args.properties ?? args.task ?? args }) });
    },
  },
];
