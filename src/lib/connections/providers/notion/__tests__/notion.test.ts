import { describe, expect, it } from 'vitest';
import { notionManifest } from '../manifest';

async function call(tool: string, args: Record<string, unknown>) {
  const def = notionManifest.tools.find((candidate) => candidate.name === tool);
  if (!def) throw new Error(`missing ${tool}`);
  return def.run(args, {});
}

describe('notion provider office results tools', () => {
  it('mock creates, appends and reads page content', async () => {
    const created = await call('notion.create_page', {
      mock: true,
      parent: { page_id: 'root' },
      properties: { Name: { type: 'title', title: [{ plain_text: 'Client brief' }] } },
      children: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Initial context' }] } }],
    });
    const pageId = String(created.details?.pageId);

    const appended = await call('notion.append_blocks', {
      mock: true,
      pageId,
      children: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Next step: prepare proposal' }] } }],
    });
    expect(appended.details?.verified).toBe(true);

    const read = await call('notion.read_page_content', { mock: true, pageId });
    expect(read.output).toContain('Client brief');
    expect(read.output).toContain('Next step');
  });

  it('mock upserts a database row and query reads it back', async () => {
    const upserted = await call('notion.upsert_database_row', {
      mock: true,
      databaseId: 'db-1',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Acme' }] } },
    });
    expect(upserted.details?.verified).toBe(true);

    const query = await call('notion.query_database', { mock: true, databaseId: 'db-1' });
    expect(query.output).toContain('Acme');
  });
});
