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
});
