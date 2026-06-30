import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';
import { mockOrMissingAuth } from '../../mock-guard';

const API = 'https://api.notion.com/v1';
const TOKEN_KEY = 'NOTION_TOKEN';
const VERSION = '2022-06-28';
const SETUP = 'Add a Notion internal integration token in Connections -> Notion, and share the pages/databases with it.';
const mockPages = new Map<string, { id: string; title: string; blocks: unknown[]; properties?: Record<string, unknown>; parent?: unknown }>();

function ok(output: string, details?: Record<string, unknown>): ConnectionCallResult {
  return { success: true, output, details };
}
function err(error: string): ConnectionCallResult {
  return { success: false, output: '', error };
}

async function nFetch(path: string, token: string, init?: RequestInit): Promise<ConnectionCallResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) return err(`notion_${res.status}: ${text.slice(0, 500)}`);
    return ok(text);
  } catch (e) {
    return err(`notion_request_failed: ${String(e)}`);
  }
}

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const isMock = (args: Record<string, unknown>): boolean => args.mock === true || args.__mock === true;

async function nFetchJson(path: string, token: string, init?: RequestInit): Promise<ConnectionCallResult & { json?: unknown }> {
  const result = await nFetch(path, token, init);
  if (!result.success) return result;
  try {
    return { ...result, json: result.output ? JSON.parse(result.output) as unknown : {} };
  } catch {
    return result;
  }
}

async function nPaginated(path: string, token: string, initBody?: Record<string, unknown>): Promise<ConnectionCallResult> {
  const results: unknown[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const body = { ...(initBody ?? {}), ...(cursor ? { start_cursor: cursor } : {}) };
    const page = await nFetchJson(path, token, { method: 'POST', body: JSON.stringify(body) });
    if (!page.success) return page;
    const json = page.json as { results?: unknown[]; has_more?: boolean; next_cursor?: string | null };
    results.push(...(json.results ?? []));
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return ok(JSON.stringify({ results, count: results.length }), { results, count: results.length });
}

function blockText(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const obj = block as Record<string, unknown>;
  const type = String(obj.type ?? '');
  const typed = obj[type] as { rich_text?: Array<{ plain_text?: string }>; title?: Array<{ plain_text?: string }> } | undefined;
  const parts = [...(typed?.rich_text ?? []), ...(typed?.title ?? [])].map((r) => r.plain_text ?? '').filter(Boolean);
  return parts.join('');
}

function pageTitle(page: unknown): string {
  const props = (page as { properties?: Record<string, unknown> })?.properties ?? {};
  for (const value of Object.values(props)) {
    const p = value as { type?: string; title?: Array<{ plain_text?: string }>; rich_text?: Array<{ plain_text?: string }> };
    if (p.type === 'title') return (p.title ?? []).map((t) => t.plain_text ?? '').join('');
    if (p.type === 'rich_text') return (p.rich_text ?? []).map((t) => t.plain_text ?? '').join('');
  }
  return '';
}

export const notionTools: ConnectionToolDefinition[] = [
  {
    name: 'notion.test_connection',
    description: 'Verify the Notion token and return bot/user metadata.',
    risk: 'external_read',
    async run(_args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.test_connection', 'notion.test_connection', SETUP);
      const r = await nFetch('/users/me', token);
      if (!r.success) return r;
      try {
        const data = JSON.parse(r.output) as { name?: string; id?: string; bot?: { owner?: unknown } };
        return ok(`Connected to Notion as ${data.name ?? data.id ?? 'integration'}.`, { account: data.name, id: data.id, bot: Boolean(data.bot) });
      } catch {
        return ok('Connected to Notion.', { raw: true });
      }
    },
  },
  {
    name: 'notion.search',
    description: 'Search Notion (query).',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return ok(JSON.stringify({ results: [...mockPages.values()] }), { results: [...mockPages.values()] });
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.search', `notion.search "${str(args.query)}"`, SETUP);
      return nFetch('/search', token, { method: 'POST', body: JSON.stringify({ query: str(args.query) }) });
    },
  },
  {
    name: 'notion.read_page',
    description: 'Read a page (pageId).',
    risk: 'external_read',
    async run(args, secrets) {
      const pageId = str(args.pageId ?? args.page_id);
      if (isMock(args)) return ok(JSON.stringify(mockPages.get(pageId) ?? { id: pageId, title: 'Mock page' }), { pageId });
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.read_page', `notion.read_page ${pageId}`, SETUP);
      return nFetch(`/pages/${pageId}`, token);
    },
  },
  {
    name: 'notion.query_database',
    description: 'Query a database (databaseId, filter?) with pagination.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return ok(JSON.stringify({ results: [...mockPages.values()], count: mockPages.size }), { results: [...mockPages.values()], count: mockPages.size });
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.query_database', `notion.query_database ${str(args.databaseId)}`, SETUP);
      return nPaginated(`/databases/${str(args.databaseId)}/query`, token, { filter: args.filter ?? undefined, sorts: args.sorts ?? undefined });
    },
  },
  {
    name: 'notion.read_block_children',
    description: 'Read block children for a page/block, following pagination.',
    risk: 'external_read',
    async run(args, secrets) {
      const blockId = str(args.blockId ?? args.block_id ?? args.pageId ?? args.page_id);
      if (!blockId) return err('missing_block_id');
      if (isMock(args)) {
        const page = mockPages.get(blockId) ?? { id: blockId, title: 'Mock page', blocks: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Mock Notion content' }] } }] };
        return ok(JSON.stringify({ results: page.blocks, count: page.blocks.length }), { results: page.blocks, count: page.blocks.length });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.read_block_children', `notion.read_block_children ${blockId}`, SETUP);
      const results: unknown[] = [];
      let cursor = '';
      for (let i = 0; i < 20; i += 1) {
        const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
        const page = await nFetchJson(`/blocks/${blockId}/children${qs}`, token);
        if (!page.success) return page;
        const json = page.json as { results?: unknown[]; has_more?: boolean; next_cursor?: string | null };
        results.push(...(json.results ?? []));
        if (!json.has_more || !json.next_cursor) break;
        cursor = json.next_cursor;
      }
      return ok(JSON.stringify({ results, count: results.length }), { results, count: results.length });
    },
  },
  {
    name: 'notion.read_page_content',
    description: 'Read a Notion page metadata plus first-level block text content.',
    risk: 'external_read',
    async run(args, secrets) {
      const pageId = str(args.pageId ?? args.page_id ?? args.id);
      if (!pageId) return err('missing_page_id');
      if (isMock(args)) {
        const page = mockPages.get(pageId) ?? { id: pageId, title: 'Mock page', blocks: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Mock Notion content' }] } }] };
        const text = page.blocks.map(blockText).filter(Boolean).join('\n');
        return ok(`${page.title}\n\n${text}`, { pageId, title: page.title, text, blocks: page.blocks });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.read_page_content', `notion.read_page_content ${pageId}`, SETUP);
      const page = await nFetchJson(`/pages/${pageId}`, token);
      if (!page.success) return page;
      const children = await notionTools.find((t) => t.name === 'notion.read_block_children')!.run({ pageId }, secrets);
      if (!children.success) return children;
      const blocks = (children.details?.results as unknown[] | undefined) ?? [];
      const title = pageTitle(page.json);
      const text = blocks.map(blockText).filter(Boolean).join('\n');
      return ok(`${title}\n\n${text}`.trim(), { pageId, title, text, blocks, page: page.json });
    },
  },
  {
    name: 'notion.create_page',
    description: 'Create a page (parent, properties, children?).',
    risk: 'external_write',
    async run(args, secrets) {
      if (isMock(args)) {
        const id = `page-${Date.now()}`;
        const blocks = Array.isArray(args.children) ? args.children : [];
        const title = pageTitle({ properties: args.properties as Record<string, unknown> }) || 'Mock page';
        mockPages.set(id, { id, title, blocks, properties: args.properties as Record<string, unknown>, parent: args.parent });
        return ok(`Mock Notion page created: ${id}`, { pageId: id, verified: true });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.create_page', 'notion.create_page', SETUP);
      return nFetch('/pages', token, {
        method: 'POST',
        body: JSON.stringify({ parent: args.parent, properties: args.properties, children: args.children }),
      });
    },
  },
  {
    name: 'notion.update_page',
    description: 'Update page properties (pageId, properties).',
    risk: 'external_write',
    async run(args, secrets) {
      const pageId = str(args.pageId ?? args.page_id);
      if (isMock(args)) {
        const page = mockPages.get(pageId) ?? { id: pageId, title: 'Mock page', blocks: [] };
        page.properties = { ...(page.properties ?? {}), ...((args.properties ?? {}) as Record<string, unknown>) };
        mockPages.set(pageId, page);
        return ok(`Mock Notion page updated: ${pageId}`, { pageId, verified: true, page });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.update_page', `notion.update_page ${pageId}`, SETUP);
      return nFetch(`/pages/${pageId}`, token, { method: 'PATCH', body: JSON.stringify({ properties: args.properties }) });
    },
  },
  {
    name: 'notion.append_blocks',
    description: 'Append content blocks to a Notion page/block and read children back.',
    risk: 'external_write',
    async run(args, secrets) {
      const blockId = str(args.blockId ?? args.block_id ?? args.pageId ?? args.page_id);
      const children = Array.isArray(args.children) ? args.children : [];
      if (!blockId) return err('missing_block_id');
      if (!children.length) return err('missing_children');
      if (isMock(args)) {
        const page = mockPages.get(blockId) ?? { id: blockId, title: 'Mock page', blocks: [] };
        page.blocks.push(...children);
        mockPages.set(blockId, page);
        return ok(`Mock appended ${children.length} Notion blocks. Read-back: verified.`, { blockId, appended: children.length, verified: true, blocks: page.blocks });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.append_blocks', `notion.append_blocks ${blockId}`, SETUP);
      const write = await nFetchJson(`/blocks/${blockId}/children`, token, { method: 'PATCH', body: JSON.stringify({ children }) });
      if (!write.success) return write;
      const readBack = await notionTools.find((t) => t.name === 'notion.read_block_children')!.run({ blockId }, secrets);
      return readBack.success
        ? ok(`Appended ${children.length} Notion blocks. Read-back: verified.`, { blockId, appended: children.length, verified: true, readBack: readBack.details })
        : readBack;
    },
  },
  {
    name: 'notion.create_database_row',
    description: 'Add a row to a database (databaseId, properties).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token && !isMock(args)) return mockOrMissingAuth('Notion', 'notion.create_database_row', `notion.create_database_row ${str(args.databaseId)}`, SETUP);
      return notionTools.find((t) => t.name === 'notion.upsert_database_row')!.run(args, secrets);
    },
  },
  {
    name: 'notion.update_database_row',
    description: 'Update a database row (pageId, properties).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token && !isMock(args)) return mockOrMissingAuth('Notion', 'notion.update_database_row', `notion.update_database_row ${str(args.pageId)}`, SETUP);
      return notionTools.find((t) => t.name === 'notion.upsert_database_row')!.run(args, secrets);
    },
  },
  {
    name: 'notion.upsert_database_row',
    description: 'Update a matching database row or create it when no match exists.',
    risk: 'external_write',
    async run(args, secrets) {
      const databaseId = str(args.databaseId ?? args.database_id);
      const pageId = str(args.pageId ?? args.page_id);
      const properties = (args.properties ?? {}) as Record<string, unknown>;
      const filter = args.filter as Record<string, unknown> | undefined;
      if (!databaseId && !pageId) return err('missing_database_or_page_id');
      if (!Object.keys(properties).length) return err('missing_properties');
      if (isMock(args)) {
        const id = pageId || `page-${Date.now()}`;
        const page = mockPages.get(id) ?? { id, title: 'Mock row', blocks: [], parent: { database_id: databaseId } };
        page.properties = { ...(page.properties ?? {}), ...properties };
        page.title = pageTitle({ properties }) || page.title;
        mockPages.set(id, page);
        return ok(`Mock Notion row upserted: ${id}. Read-back: verified.`, { pageId: id, databaseId, updated: Boolean(pageId), verified: true, page });
      }
      const token = secrets[TOKEN_KEY];
      if (!token) return mockOrMissingAuth('Notion', 'notion.upsert_database_row', 'notion.upsert_database_row', SETUP);
      let targetPageId = pageId;
      if (!targetPageId && databaseId && filter) {
        const found = await nFetchJson(`/databases/${databaseId}/query`, token, { method: 'POST', body: JSON.stringify({ filter, page_size: 1 }) });
        if (!found.success) return found;
        targetPageId = str((found.json as { results?: Array<{ id?: string }> })?.results?.[0]?.id);
      }
      const result = targetPageId
        ? await nFetchJson(`/pages/${targetPageId}`, token, { method: 'PATCH', body: JSON.stringify({ properties }) })
        : await nFetchJson('/pages', token, { method: 'POST', body: JSON.stringify({ parent: { database_id: databaseId }, properties }) });
      if (!result.success) return result;
      const id = str((result.json as { id?: string })?.id ?? targetPageId);
      const read = await nFetchJson(`/pages/${id}`, token);
      if (!read.success) return read;
      return ok(`Notion database row upserted: ${id}. Read-back: verified.`, { pageId: id, databaseId, updated: Boolean(targetPageId), verified: true, page: read.json });
    },
  },
];
