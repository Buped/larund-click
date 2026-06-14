import type { ConnectionManifest } from '../../types';
import { notionTools } from './tools';

export const notionManifest: ConnectionManifest = {
  id: 'notion',
  name: 'Notion',
  description: 'Search, read and write Notion pages and databases.',
  auth: { type: 'api_key', envVars: ['NOTION_TOKEN'] },
  tools: notionTools,
  skills: ['notion-workspace'],
  risk: 'external_write',
};
