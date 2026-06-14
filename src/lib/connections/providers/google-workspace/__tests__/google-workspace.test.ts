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
});
