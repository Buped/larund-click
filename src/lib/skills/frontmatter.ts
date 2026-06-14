import type { ToolRisk } from '../control-system/types';
import type { SkillManifest } from './types';

const VALID_RISK: ToolRisk[] = [
  'read_only', 'local_write', 'external_read', 'external_write',
  'external_send', 'destructive', 'credential_access', 'process_exec',
];

export interface ParsedSkillFile {
  manifest?: SkillManifest;
  body: string;
  error?: string;
}

/** Parse a minimal YAML-ish list value: `["a", "b"]` or `[a, b]` or empty. */
function parseList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']/, '').replace(/["']$/, ''))
    .filter(Boolean);
}

function parseScalar(raw: string): string {
  return raw.trim().replace(/^["']/, '').replace(/["']$/, '');
}

/**
 * Parse a SKILL.md file: a `---` fenced YAML frontmatter block followed by the
 * markdown body. Validates required fields and risk enum.
 */
export function parseSkillFile(text: string): ParsedSkillFile {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { body: text, error: 'missing_frontmatter' };

  const [, fm, body] = match;
  const fields: Record<string, string> = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2];
  }

  const name = parseScalar(fields.name ?? '');
  const description = parseScalar(fields.description ?? '');
  if (!name) return { body, error: 'missing_name' };
  if (!description) return { body, error: 'missing_description' };

  const risk = (parseScalar(fields.risk ?? 'read_only') as ToolRisk);
  if (!VALID_RISK.includes(risk)) return { body, error: `invalid_risk:${risk}` };

  const manifest: SkillManifest = {
    name,
    description,
    allowed_tools: parseList(fields.allowed_tools ?? '[]'),
    requires_connections: parseList(fields.requires_connections ?? '[]'),
    risk,
    trigger: fields.trigger ? parseScalar(fields.trigger) : undefined,
  };
  return { manifest, body: body.trim() };
}
