import type { ToolRisk } from '../control-system/types';
import type { SkillManifest } from './types';

const VALID_RISK: ToolRisk[] = [
  'read_only', 'local_write', 'external_read', 'external_write',
  'external_send', 'destructive', 'credential_access', 'process_exec',
];

const VALID_STATUS = new Set(['pending_review', 'reviewed', 'enabled', 'disabled', 'blocked', 'deprecated']);
const FORBIDDEN_TOOL_RE = /(^|[._:-])(mouse|cursor|screenshot|pixel|ocr|visual[_-]?click|click[_-]?visual)([._:-]|$)/i;

export interface ParsedSkillFile {
  manifest?: SkillManifest;
  body: string;
  error?: string;
}

type FrontmatterValue = string | boolean | string[] | Record<string, unknown>;

function stripQuotes(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return value;
}

function splitInlineArray(inner: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if ((ch === '"' || ch === "'") && inner[i - 1] !== '\\') {
      quote = quote === ch ? null : quote ?? ch;
      current += ch;
    } else if (ch === ',' && !quote) {
      const item = stripQuotes(current);
      if (item) out.push(item);
      current = '';
    } else {
      current += ch;
    }
  }
  const item = stripQuotes(current);
  if (item) out.push(item);
  return out;
}

function parseValue(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) return splitInlineArray(value.slice(1, -1));
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return stripQuotes(value);
}

function parseFrontmatter(fm: string): Record<string, FrontmatterValue> {
  const fields: Record<string, FrontmatterValue> = {};
  const lines = fm.replace(/\r\n/g, '\n').split('\n');
  let currentListKey: string | null = null;
  let currentObjectKey: string | null = null;

  for (const rawLine of lines) {
    const noComment = rawLine.replace(/\s+#.*$/, '');
    if (!noComment.trim()) continue;
    const indent = noComment.match(/^\s*/)?.[0].length ?? 0;

    if (indent > 0 && currentListKey && noComment.trim().startsWith('- ')) {
      const list = (Array.isArray(fields[currentListKey]) ? fields[currentListKey] : []) as string[];
      list.push(stripQuotes(noComment.trim().slice(2)));
      fields[currentListKey] = list;
      continue;
    }

    if (indent > 0 && currentObjectKey) {
      const nested = noComment.trim().match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (nested) {
        const obj = (typeof fields[currentObjectKey] === 'object' && !Array.isArray(fields[currentObjectKey])
          ? fields[currentObjectKey]
          : {}) as Record<string, unknown>;
        obj[nested[1]] = parseValue(nested[2]);
        fields[currentObjectKey] = obj;
      }
      continue;
    }

    currentListKey = null;
    currentObjectKey = null;
    const m = noComment.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (!rawValue.trim()) {
      fields[key] = key === 'metadata' || key === 'origin' ? {} : [];
      currentListKey = key;
      currentObjectKey = key === 'metadata' || key === 'origin' ? key : null;
    } else {
      fields[key] = parseValue(rawValue);
    }
  }
  return fields;
}

function asString(value: FrontmatterValue | undefined, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function asList(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.includes(',')) return splitInlineArray(trimmed);
    return [trimmed];
  }
  return [];
}

function asBool(value: FrontmatterValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(true|yes|1)$/i.test(value);
  return undefined;
}

function nestedString(fields: Record<string, FrontmatterValue>, key: 'origin' | 'metadata', nestedKey: string): string | undefined {
  const obj = fields[key];
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') return undefined;
  const value = obj[nestedKey];
  return typeof value === 'string' ? value : undefined;
}

export function parseSkillFile(text: string): ParsedSkillFile {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { body: text, error: 'missing_frontmatter' };

  const [, fm, body] = match;
  const fields = parseFrontmatter(fm);

  const name = asString(fields.name);
  const description = asString(fields.description);
  if (!name) return { body, error: 'missing_name' };
  if (!description) return { body, error: 'missing_description' };

  const risk = (asString(fields.risk, 'read_only') as ToolRisk);
  if (!VALID_RISK.includes(risk)) return { body, error: `invalid_risk:${risk}` };

  const allowedTools = asList(fields.allowed_tools);
  const forbidden = allowedTools.find((tool) => FORBIDDEN_TOOL_RE.test(tool));
  if (forbidden) return { body, error: `forbidden_tool:${forbidden}` };

  const status = asString(fields.status) || undefined;
  if (status && !VALID_STATUS.has(status)) return { body, error: `invalid_status:${status}` };

  const categories = asList(fields.categories).length ? asList(fields.categories) : asList(fields.category);

  const manifest: SkillManifest = {
    name,
    description,
    allowed_tools: allowedTools,
    requires_connections: asList(fields.requires_connections).length
      ? asList(fields.requires_connections)
      : asList(fields.required_connections),
    risk,
    trigger: asString(fields.trigger) || asList(fields.trigger_phrases).join(' ') || undefined,
    version: asString(fields.version) || undefined,
    categories,
    category: asString(fields.category) || undefined,
    tags: asList(fields.tags),
    verification_checklist: asList(fields.verification_checklist),
    when_to_use: asList(fields.when_to_use),
    when_not_to_use: asList(fields.when_not_to_use),
    required_mcp_servers: asList(fields.required_mcp_servers),
    enabled_by_default: asBool(fields.enabled_by_default),
    license: asString(fields.license) || undefined,
    author: asString(fields.author) || undefined,
    updated: asString(fields.updated) || undefined,
    status: status as SkillManifest['status'],
    origin_repo: asString(fields.origin_repo) || nestedString(fields, 'origin', 'repo'),
    origin_path: asString(fields.origin_path) || nestedString(fields, 'origin', 'path'),
    supports_automation: asBool(fields.supports_automation),
    supports_manual_run: asBool(fields.supports_manual_run),
    metadata: typeof fields.metadata === 'object' && !Array.isArray(fields.metadata) ? fields.metadata : undefined,
  };
  return { manifest, body: body.trim() };
}
