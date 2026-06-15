import type { ToolRisk } from '../tools/types';
import type { CustomApiTool } from './types';

export function classifyCustomApiTool(input: Pick<CustomApiTool, 'method' | 'name' | 'pathTemplate' | 'description'>): ToolRisk {
  const text = `${input.name} ${input.pathTemplate} ${input.description}`.toLowerCase();
  if (/(send|email|message|publish|post|reply|notify)/.test(text)) return 'external_send';
  if (input.method === 'DELETE' || /(delete|remove|destroy|wipe|drop|truncate)/.test(text)) return 'destructive';
  if (input.method === 'GET') return 'external_read';
  return 'external_write';
}
