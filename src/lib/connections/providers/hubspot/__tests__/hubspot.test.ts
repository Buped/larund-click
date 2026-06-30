import { describe, expect, it } from 'vitest';
import { hubspotManifest } from '../manifest';

async function call(tool: string, args: Record<string, unknown>) {
  const def = hubspotManifest.tools.find((candidate) => candidate.name === tool);
  if (!def) throw new Error(`missing ${tool}`);
  return def.run(args, {});
}

describe('hubspot provider office results tools', () => {
  it('mock creates, updates and reads a contact', async () => {
    const created = await call('hubspot.create_contact', {
      mock: true,
      properties: { email: 'ada@example.com', firstname: 'Ada' },
    });
    const contactId = String(created.details?.contactId);
    expect(created.output).toMatch(/Read-back: verified/);

    const updated = await call('hubspot.update_contact', {
      mock: true,
      id: contactId,
      properties: { hs_lead_status: 'OPEN' },
    });
    expect(updated.details?.verified).toBe(true);

    const read = await call('hubspot.get_contact', { mock: true, id: contactId });
    expect(read.output).toContain('ada@example.com');
  });

  it('mock supports deals, notes, tasks and associations', async () => {
    const deal = await call('hubspot.create_deal', { mock: true, properties: { dealname: 'Acme deal', dealstage: 'new' } });
    const dealId = String(deal.details?.dealId);

    const stage = await call('hubspot.update_deal_stage', { mock: true, id: dealId, stageId: 'qualified' });
    expect(stage.details?.verified).toBe(true);

    const note = await call('hubspot.create_note', { mock: true, body: 'Meeting summary' });
    expect(note.output).toMatch(/Read-back: verified/);

    const task = await call('hubspot.create_task', { mock: true, properties: { hs_task_subject: 'Follow up', hs_task_status: 'NOT_STARTED' } });
    expect(task.details?.verified).toBe(true);

    const associated = await call('hubspot.associate_records', {
      mock: true,
      fromObjectType: 'deals',
      fromObjectId: dealId,
      toObjectType: 'tasks',
      toObjectId: String(task.details?.taskId),
    });
    expect(associated.details?.verified).toBe(true);
  });

  it('mock batch upserts contacts by email and exposes CRM metadata', async () => {
    const upsert = await call('hubspot.batch_upsert_contacts', {
      mock: true,
      contacts: [
        { email: 'one@example.com', firstname: 'One' },
        { email: 'two@example.com', firstname: 'Two' },
      ],
    });
    expect(upsert.details?.verified).toBe(true);
    expect(upsert.details?.count).toBe(2);

    expect((await call('hubspot.get_properties', { mock: true, objectType: 'contacts' })).output).toContain('email');
    expect((await call('hubspot.get_pipelines', { mock: true, objectType: 'deals' })).output).toContain('Default');
  });
});
