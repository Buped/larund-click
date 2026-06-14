import type { ConnectionToolDefinition, ConnectionCallResult } from '../../types';

const API = 'https://api.notion.com/v1';
const TOKEN_KEY = 'NOTION_TOKEN';
const VERSION = '2022-06-28';

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
    if (!res.ok) return err(`notion_${res.status}: ${text.slice(0, 300)}`);
    return ok(text);
  } catch (e) {
    return err(`notion_request_failed: ${String(e)}`);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const notionTools: ConnectionToolDefinition[] = [
  {
    name: 'notion.search',
    description: 'Search Notion (query).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.search "${str(args.query)}" → 1 page`, { mock: true });
      return nFetch('/search', token, { method: 'POST', body: JSON.stringify({ query: str(args.query) }) });
    },
  },
  {
    name: 'notion.read_page',
    description: 'Read a page (pageId).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.read_page ${str(args.pageId)}`, { mock: true });
      return nFetch(`/pages/${str(args.pageId)}`, token);
    },
  },
  {
    name: 'notion.query_database',
    description: 'Query a database (databaseId, filter?).',
    risk: 'external_read',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.query_database ${str(args.databaseId)}`, { mock: true });
      return nFetch(`/databases/${str(args.databaseId)}/query`, token, {
        method: 'POST', body: JSON.stringify({ filter: args.filter ?? undefined }),
      });
    },
  },
  {
    name: 'notion.create_page',
    description: 'Create a page (parent, properties, children?).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.create_page (would create under ${JSON.stringify(args.parent)})`, { mock: true });
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
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.update_page ${str(args.pageId)}`, { mock: true });
      return nFetch(`/pages/${str(args.pageId)}`, token, { method: 'PATCH', body: JSON.stringify({ properties: args.properties }) });
    },
  },
  {
    name: 'notion.create_database_row',
    description: 'Add a row to a database (databaseId, properties).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.create_database_row in ${str(args.databaseId)}`, { mock: true });
      return nFetch('/pages', token, {
        method: 'POST',
        body: JSON.stringify({ parent: { database_id: str(args.databaseId) }, properties: args.properties }),
      });
    },
  },
  {
    name: 'notion.update_database_row',
    description: 'Update a database row (pageId, properties).',
    risk: 'external_write',
    async run(args, secrets) {
      const token = secrets[TOKEN_KEY];
      if (!token) return ok(`[mock] notion.update_database_row ${str(args.pageId)}`, { mock: true });
      return nFetch(`/pages/${str(args.pageId)}`, token, { method: 'PATCH', body: JSON.stringify({ properties: args.properties }) });
    },
  },
];
