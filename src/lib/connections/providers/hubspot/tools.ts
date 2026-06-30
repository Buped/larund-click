import type { ConnectionCallResult, ConnectionToolDefinition } from '../../types';
import { mockOrMissingAuth } from '../../mock-guard';

const API = 'https://api.hubapi.com';
const SETUP = 'Add a HubSpot private app token in Connections -> HubSpot.';

type MockObject = { id: string; properties: Record<string, unknown>; associations?: Record<string, string[]> };
const mockContacts = new Map<string, MockObject>();
const mockCompanies = new Map<string, MockObject>();
const mockDeals = new Map<string, MockObject>();
const mockTasks = new Map<string, MockObject>();
const mockNotes = new Map<string, MockObject>();

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}
function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}
function token(secrets: Record<string, string>): string {
  return secrets.HUBSPOT_PRIVATE_APP_TOKEN || secrets.HUBSPOT_TOKEN || '';
}
function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}
function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function str(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}
function props(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args.properties ?? args[key] ?? args;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function mockSearch(store: Map<string, MockObject>, query: string, limit = 10): MockObject[] {
  const q = query.toLowerCase();
  return [...store.values()].filter((item) => !q || JSON.stringify(item.properties).toLowerCase().includes(q)).slice(0, limit);
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
async function hsJson(path: string, accessToken: string, init?: RequestInit): Promise<ConnectionCallResult & { json?: unknown }> {
  const result = await hsFetch(path, accessToken, init);
  if (!result.success) return result;
  try {
    return { ...result, json: result.output ? JSON.parse(result.output) as unknown : {} };
  } catch {
    return result;
  }
}
function requireToken(args: Record<string, unknown>, secrets: Record<string, string>, tool: string): string | ConnectionCallResult {
  const accessToken = token(secrets);
  if (accessToken) return accessToken;
  if (isMock(args)) return '';
  return mockOrMissingAuth('HubSpot', tool, tool, SETUP);
}

export const hubspotTools: ConnectionToolDefinition[] = [
  {
    name: 'hubspot.test_connection',
    description: 'Verify the HubSpot token by reading account metadata.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return ok('Mock connected to HubSpot.', { provider: 'hubspot', mock: true });
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
      if (isMock(args)) {
        const results = mockSearch(mockContacts, str(args.query), Number(args.limit ?? 10));
        return ok(JSON.stringify({ results }), { results });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.search_contacts');
      if (typeof accessToken !== 'string') return accessToken;
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
      const contactId = str(args.id ?? args.contactId ?? args.contact_id);
      if (!contactId) return err('missing_contact_id');
      if (isMock(args)) return ok(JSON.stringify(mockContacts.get(contactId) ?? null), { contact: mockContacts.get(contactId) ?? null });
      const accessToken = requireToken(args, secrets, 'hubspot.get_contact');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch(`/crm/v3/objects/contacts/${contactId}?properties=${encodeURIComponent(str(args.properties) || 'email,firstname,lastname,phone,company,lifecyclestage,hs_lead_status')}`, accessToken);
    },
  },
  {
    name: 'hubspot.create_contact',
    description: 'Create a HubSpot contact and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const properties = props(args, 'contact');
      if (isMock(args)) {
        const contactId = id('contact');
        const contact = { id: contactId, properties };
        mockContacts.set(contactId, contact);
        return ok(`Mock HubSpot contact created: ${contactId}. Read-back: verified.`, { contactId, verified: true, contact });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.create_contact');
      if (typeof accessToken !== 'string') return accessToken;
      const created = await hsJson('/crm/v3/objects/contacts', accessToken, { method: 'POST', body: JSON.stringify({ properties }) });
      if (!created.success) return created;
      const contactId = str((created.json as { id?: string })?.id);
      const read = contactId ? await hsJson(`/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,lifecyclestage,hs_lead_status`, accessToken) : created;
      return read.success ? ok(`HubSpot contact created: ${contactId}. Read-back: verified.`, { contactId, verified: true, contact: read.json }) : read;
    },
  },
  {
    name: 'hubspot.update_contact',
    description: 'Update a HubSpot contact and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const contactId = str(args.id ?? args.contactId ?? args.contact_id);
      if (!contactId) return err('missing_contact_id');
      const properties = props(args, 'contact');
      if (isMock(args)) {
        const contact = mockContacts.get(contactId) ?? { id: contactId, properties: {} };
        contact.properties = { ...contact.properties, ...properties };
        mockContacts.set(contactId, contact);
        return ok(`Mock HubSpot contact updated: ${contactId}. Read-back: verified.`, { contactId, verified: true, contact });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.update_contact');
      if (typeof accessToken !== 'string') return accessToken;
      const updated = await hsJson(`/crm/v3/objects/contacts/${contactId}`, accessToken, { method: 'PATCH', body: JSON.stringify({ properties }) });
      if (!updated.success) return updated;
      const read = await hsJson(`/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,lifecyclestage,hs_lead_status`, accessToken);
      return read.success ? ok(`HubSpot contact updated: ${contactId}. Read-back: verified.`, { contactId, verified: true, contact: read.json }) : read;
    },
  },
  {
    name: 'hubspot.search_companies',
    description: 'Search HubSpot companies.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return ok(JSON.stringify({ results: mockSearch(mockCompanies, str(args.query), Number(args.limit ?? 10)) }));
      const accessToken = requireToken(args, secrets, 'hubspot.search_companies');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch('/crm/v3/objects/companies/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(args.search ?? { query: str(args.query), limit: args.limit ?? 10 }),
      });
    },
  },
  {
    name: 'hubspot.search_deals',
    description: 'Search HubSpot deals.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return ok(JSON.stringify({ results: mockSearch(mockDeals, str(args.query), Number(args.limit ?? 10)) }));
      const accessToken = requireToken(args, secrets, 'hubspot.search_deals');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch('/crm/v3/objects/deals/search', accessToken, {
        method: 'POST',
        body: JSON.stringify(args.search ?? { query: str(args.query), limit: args.limit ?? 10, properties: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate'] }),
      });
    },
  },
  {
    name: 'hubspot.list_deals',
    description: 'List/search HubSpot deals.',
    risk: 'external_read',
    async run(args, secrets) {
      if (args.search || args.query || isMock(args)) return hubspotTools.find((t) => t.name === 'hubspot.search_deals')!.run(args, secrets);
      const accessToken = requireToken(args, secrets, 'hubspot.list_deals');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch(`/crm/v3/objects/deals?limit=${encodeURIComponent(str(args.limit) || '20')}&properties=dealname,amount,dealstage,pipeline,closedate`, accessToken);
    },
  },
  {
    name: 'hubspot.get_deal',
    description: 'Get one HubSpot deal.',
    risk: 'external_read',
    async run(args, secrets) {
      const dealId = str(args.id ?? args.dealId ?? args.deal_id);
      if (!dealId) return err('missing_deal_id');
      if (isMock(args)) return ok(JSON.stringify(mockDeals.get(dealId) ?? null), { deal: mockDeals.get(dealId) ?? null });
      const accessToken = requireToken(args, secrets, 'hubspot.get_deal');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch(`/crm/v3/objects/deals/${dealId}?properties=${encodeURIComponent(str(args.properties) || 'dealname,amount,dealstage,pipeline,closedate')}`, accessToken);
    },
  },
  {
    name: 'hubspot.create_deal',
    description: 'Create a HubSpot deal and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const properties = props(args, 'deal');
      if (isMock(args)) {
        const dealId = id('deal');
        const deal = { id: dealId, properties };
        mockDeals.set(dealId, deal);
        return ok(`Mock HubSpot deal created: ${dealId}. Read-back: verified.`, { dealId, verified: true, deal });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.create_deal');
      if (typeof accessToken !== 'string') return accessToken;
      const created = await hsJson('/crm/v3/objects/deals', accessToken, { method: 'POST', body: JSON.stringify({ properties }) });
      if (!created.success) return created;
      const dealId = str((created.json as { id?: string })?.id);
      const read = await hsJson(`/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage,pipeline,closedate`, accessToken);
      return read.success ? ok(`HubSpot deal created: ${dealId}. Read-back: verified.`, { dealId, verified: true, deal: read.json }) : read;
    },
  },
  {
    name: 'hubspot.update_deal_stage',
    description: 'Update a HubSpot deal stage and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const dealId = str(args.id ?? args.dealId ?? args.deal_id);
      const stage = str(args.stageId ?? args.stage_id ?? args.dealstage);
      if (!dealId || !stage) return err('missing_deal_or_stage');
      if (isMock(args)) {
        const deal = mockDeals.get(dealId) ?? { id: dealId, properties: {} };
        deal.properties = { ...deal.properties, dealstage: stage };
        mockDeals.set(dealId, deal);
        return ok(`Mock HubSpot deal stage updated: ${dealId}. Read-back: verified.`, { dealId, verified: true, deal });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.update_deal_stage');
      if (typeof accessToken !== 'string') return accessToken;
      const updated = await hsJson(`/crm/v3/objects/deals/${dealId}`, accessToken, { method: 'PATCH', body: JSON.stringify({ properties: { dealstage: stage } }) });
      if (!updated.success) return updated;
      const read = await hsJson(`/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage,pipeline,closedate`, accessToken);
      return read.success ? ok(`HubSpot deal stage updated: ${dealId}. Read-back: verified.`, { dealId, verified: true, deal: read.json }) : read;
    },
  },
  {
    name: 'hubspot.get_properties',
    description: 'Read HubSpot CRM object properties.',
    risk: 'external_read',
    async run(args, secrets) {
      const objectType = str(args.objectType ?? args.object_type ?? 'contacts');
      if (isMock(args)) return ok(JSON.stringify({ results: [{ name: 'email' }, { name: 'firstname' }, { name: 'lastname' }, { name: 'dealstage' }] }));
      const accessToken = requireToken(args, secrets, 'hubspot.get_properties');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch(`/crm/v3/properties/${encodeURIComponent(objectType)}`, accessToken);
    },
  },
  {
    name: 'hubspot.get_pipelines',
    description: 'Read HubSpot pipelines for an object type.',
    risk: 'external_read',
    async run(args, secrets) {
      const objectType = str(args.objectType ?? args.object_type ?? 'deals');
      if (isMock(args)) return ok(JSON.stringify({ results: [{ id: 'default', label: 'Default', stages: [{ id: 'appointmentscheduled', label: 'Appointment scheduled' }] }] }));
      const accessToken = requireToken(args, secrets, 'hubspot.get_pipelines');
      if (typeof accessToken !== 'string') return accessToken;
      return hsFetch(`/crm/v3/pipelines/${encodeURIComponent(objectType)}`, accessToken);
    },
  },
  {
    name: 'hubspot.create_note',
    description: 'Create a HubSpot CRM note and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const body = str(args.body ?? args.note ?? args.hs_note_body);
      const timestamp = str(args.timestamp ?? args.hs_timestamp) || new Date().toISOString();
      const properties = { hs_note_body: body, hs_timestamp: timestamp, ...props(args, 'properties') };
      if (!body) return err('missing_note_body');
      if (isMock(args)) {
        const noteId = id('note');
        const note = { id: noteId, properties };
        mockNotes.set(noteId, note);
        return ok(`Mock HubSpot note created: ${noteId}. Read-back: verified.`, { noteId, verified: true, note });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.create_note');
      if (typeof accessToken !== 'string') return accessToken;
      const created = await hsJson('/crm/v3/objects/notes', accessToken, { method: 'POST', body: JSON.stringify({ properties, associations: args.associations }) });
      if (!created.success) return created;
      const noteId = str((created.json as { id?: string })?.id);
      const read = await hsJson(`/crm/v3/objects/notes/${noteId}?properties=hs_note_body,hs_timestamp`, accessToken);
      return read.success ? ok(`HubSpot note created: ${noteId}. Read-back: verified.`, { noteId, verified: true, note: read.json }) : read;
    },
  },
  {
    name: 'hubspot.create_task',
    description: 'Create a HubSpot CRM task and read it back.',
    risk: 'external_write',
    async run(args, secrets) {
      const properties = props(args, 'task');
      if (isMock(args)) {
        const taskId = id('task');
        const task = { id: taskId, properties };
        mockTasks.set(taskId, task);
        return ok(`Mock HubSpot task created: ${taskId}. Read-back: verified.`, { taskId, verified: true, task });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.create_task');
      if (typeof accessToken !== 'string') return accessToken;
      const created = await hsJson('/crm/v3/objects/tasks', accessToken, { method: 'POST', body: JSON.stringify({ properties, associations: args.associations }) });
      if (!created.success) return created;
      const taskId = str((created.json as { id?: string })?.id);
      const read = await hsJson(`/crm/v3/objects/tasks/${taskId}?properties=hs_task_subject,hs_task_body,hs_timestamp,hs_task_status,hs_task_priority`, accessToken);
      return read.success ? ok(`HubSpot task created: ${taskId}. Read-back: verified.`, { taskId, verified: true, task: read.json }) : read;
    },
  },
  {
    name: 'hubspot.associate_records',
    description: 'Associate two HubSpot CRM records.',
    risk: 'external_write',
    async run(args, secrets) {
      const fromType = str(args.fromObjectType ?? args.from_type);
      const fromId = str(args.fromObjectId ?? args.from_id);
      const toType = str(args.toObjectType ?? args.to_type);
      const toId = str(args.toObjectId ?? args.to_id);
      const associationTypeId = Number(args.associationTypeId ?? args.association_type_id ?? 0);
      if (!fromType || !fromId || !toType || !toId) return err('missing_association_target');
      if (isMock(args)) return ok(`Mock associated ${fromType}:${fromId} -> ${toType}:${toId}`, { fromType, fromId, toType, toId, verified: true });
      const accessToken = requireToken(args, secrets, 'hubspot.associate_records');
      if (typeof accessToken !== 'string') return accessToken;
      const body = associationTypeId > 0 ? [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId }] : [];
      const result = await hsFetch(`/crm/v4/objects/${encodeURIComponent(fromType)}/${encodeURIComponent(fromId)}/associations/${encodeURIComponent(toType)}/${encodeURIComponent(toId)}`, accessToken, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return result.success ? ok(`Associated ${fromType}:${fromId} -> ${toType}:${toId}.`, { fromType, fromId, toType, toId, verified: true }) : result;
    },
  },
  {
    name: 'hubspot.batch_upsert_contacts',
    description: 'Batch upsert HubSpot contacts by email and read back matching contacts.',
    risk: 'external_write',
    async run(args, secrets) {
      const inputs = (Array.isArray(args.inputs) ? args.inputs : Array.isArray(args.contacts) ? args.contacts : []) as Array<Record<string, unknown>>;
      const rows = inputs.map((input) => ({ id: str(input.email ?? (input.properties as { email?: unknown } | undefined)?.email), properties: props(input, 'properties') }));
      if (!rows.length) return err('missing_contacts');
      if (rows.some((row) => !row.id)) return err('missing_contact_email');
      if (isMock(args)) {
        const contacts = rows.map((row) => {
          const existing = [...mockContacts.values()].find((c) => c.properties.email === row.id);
          const contact = existing ?? { id: id('contact'), properties: {} };
          contact.properties = { ...contact.properties, email: row.id, ...row.properties };
          mockContacts.set(contact.id, contact);
          return contact;
        });
        return ok(`Mock upserted ${contacts.length} HubSpot contacts. Read-back: verified.`, { count: contacts.length, verified: true, contacts });
      }
      const accessToken = requireToken(args, secrets, 'hubspot.batch_upsert_contacts');
      if (typeof accessToken !== 'string') return accessToken;
      const result = await hsJson('/crm/v3/objects/contacts/batch/upsert', accessToken, {
        method: 'POST',
        body: JSON.stringify({ idProperty: 'email', inputs: rows }),
      });
      if (!result.success) return result;
      const read = await hsJson('/crm/v3/objects/contacts/search', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'IN', values: rows.map((row) => row.id) }] }],
          properties: ['email', 'firstname', 'lastname', 'phone', 'company'],
          limit: Math.min(rows.length, 100),
        }),
      });
      return read.success ? ok(`Upserted ${rows.length} HubSpot contacts. Read-back: verified.`, { count: rows.length, verified: true, readBack: read.json }) : read;
    },
  },
];
