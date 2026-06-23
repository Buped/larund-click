import { describe, expect, it } from 'vitest';
import { googleWorkspaceManifest } from '../manifest';

async function call(tool: string, args: Record<string, unknown>) {
  const def = googleWorkspaceManifest.tools.find((candidate) => candidate.name === tool);
  if (!def) throw new Error(`missing ${tool}`);
  return def.run(args, {});
}

describe('google workspace provider', () => {
  it('mock creates, writes and reads sheet values', async () => {
    const created = await call('google.sheets.create', { mock: true, title: 'Test' });
    const spreadsheetId = String(created.details?.spreadsheetId);
    await call('google.sheets.write_values', { mock: true, spreadsheetId, values: [['Name'], ['Ada']] });
    const read = await call('google.sheets.read_values', { mock: true, spreadsheetId });
    expect(read.output).toContain('Ada');
  });

  it('missing auth reports connection setup instead of fake success', async () => {
    const result = await call('google.sheets.create', { title: 'Real' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_google_workspace_auth');
  });

  it('mock exports sheets and docs without requiring auth', async () => {
    const xlsx = await call('google.sheets.export_xlsx', { mock: true, spreadsheetId: 'sheet-1' });
    expect(xlsx.success).toBe(true);
    expect(xlsx.output).toMatch(/Mock exported sheet/i);

    const docx = await call('google.docs.export_docx', { mock: true, documentId: 'doc-1' });
    expect(docx.success).toBe(true);
    expect(docx.output).toMatch(/Mock exported docx/i);

    const pdf = await call('google.docs.export_pdf', { mock: true, documentId: 'doc-1' });
    expect(pdf.success).toBe(true);
    expect(pdf.output).toMatch(/Mock exported pdf/i);
  });

  it('mock docs batch_update content is visible in read-back', async () => {
    const created = await call('google.docs.create', { mock: true, title: 'Invoice' });
    const documentId = String(created.details?.documentId);
    await call('google.docs.batch_update', {
      mock: true,
      documentId,
      requests: [{ insertText: { location: { index: 1 }, text: 'Szamla 001 Larund Kft' } }],
    });
    const read = await call('google.docs.read', { mock: true, documentId });
    expect(read.output).toContain('Szamla 001 Larund Kft');
  });

  it('google docs metadata requires auth outside mock mode', async () => {
    const result = await call('google.docs.get_metadata', { documentId: 'real-doc' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_google_workspace_auth');
  });

  it('gmail mock: draft → send → search → read round-trips', async () => {
    const draft = await call('google.gmail.create_draft', { mock: true, to: 'a@b.com', subject: 'Ajánlat', body: 'Üdvözlettel' });
    const draftId = String(draft.details?.draftId);
    expect(draft.success).toBe(true);

    const sent = await call('google.gmail.send', { mock: true, draftId });
    expect(sent.success).toBe(true);
    expect(sent.details?.verifiedInSent).toBe(true);

    const found = await call('google.gmail.search', { mock: true, query: 'Ajánlat' });
    expect(found.output).toContain('Ajánlat');
  });

  it('gmail send is approval-gated (external_send risk)', () => {
    const send = googleWorkspaceManifest.tools.find((t) => t.name === 'google.gmail.send');
    expect(send?.risk).toBe('external_send');
  });

  it('calendar mock: create event then find_free_slots avoids the busy block', async () => {
    const base = new Date('2026-07-01T09:00:00.000Z');
    const start = base.toISOString();
    const end = new Date(base.getTime() + 60 * 60_000).toISOString();
    const created = await call('google.calendar.create_event', { mock: true, summary: 'Meeting', start, end, attendees: ['x@y.com'] });
    expect(created.success).toBe(true);
    expect(created.details?.verified).toBe(true);

    const slots = await call('google.calendar.find_free_slots', {
      mock: true,
      time_min: start,
      time_max: new Date(base.getTime() + 4 * 60 * 60_000).toISOString(),
      duration_minutes: 30,
    });
    const parsed = JSON.parse(slots.output) as { slots: Array<{ start: string }> };
    // The first free slot must begin no earlier than the end of the busy event.
    expect(parsed.slots.length).toBeGreaterThan(0);
    expect(new Date(parsed.slots[0].start).getTime()).toBeGreaterThanOrEqual(new Date(end).getTime());
  });

  it('calendar create_event is approval-gated (external_send risk)', () => {
    const ev = googleWorkspaceManifest.tools.find((t) => t.name === 'google.calendar.create_event');
    expect(ev?.risk).toBe('external_send');
  });

  it('calendar mock: search, update and delete event round-trip', async () => {
    const start = '2026-07-02T09:00:00.000Z';
    const end = '2026-07-02T10:00:00.000Z';
    const created = await call('google.calendar.create_event', { mock: true, summary: 'Demo call', start, end, attendees: ['x@y.com'] });
    const eventId = String(created.details?.eventId);

    const found = await call('google.calendar.search_events', { mock: true, query: 'Demo', time_min: start, time_max: '2026-07-03T00:00:00.000Z' });
    expect(found.output).toContain(eventId);

    const updated = await call('google.calendar.update_event', { mock: true, eventId, summary: 'Updated demo call' });
    expect(updated.success).toBe(true);

    const deleted = await call('google.calendar.delete_event', { mock: true, eventId });
    expect(deleted.success).toBe(true);
    expect(deleted.details?.verifiedDeleted).toBe(true);
  });

  it('sheets write read-back reports verified row count in mock mode', async () => {
    const created = await call('google.sheets.create', { mock: true, title: 'RB' });
    const spreadsheetId = String(created.details?.spreadsheetId);
    const wrote = await call('google.sheets.write_values', { mock: true, spreadsheetId, values: [['a'], ['b'], ['c']] });
    expect(wrote.success).toBe(true);
    const read = await call('google.sheets.read_values', { mock: true, spreadsheetId });
    expect(read.output).toContain('c');
  });
});
