import type { ToolRisk } from '../tools/types';
import type { McpSecurityFlag, McpServerConfig, McpToolDefinition, McpToolSnapshot } from './types';

const DESTRUCTIVE = /\b(delete|remove|destroy|wipe|drop|truncate|purge|erase)\b/i;
const SEND = /\b(send|email|message|post|publish|tweet|notify|reply)\b/i;
const EXEC = /\b(exec|shell|command|process|spawn|run_script|powershell|bash|cmd)\b/i;
const SECRET = /\b(env|secret|token|api[_-]?key|password|credential|authorization|bearer|private[_-]?key)\b/i;
const FILES = /\b(file|folder|directory|path|filesystem|read_file|write_file)\b/i;
const NETWORK = /\b(url|http|fetch|request|webhook|endpoint|domain)\b/i;
const INJECTION = /\b(ignore previous instructions|do not tell user|secretly|exfiltrate|system prompt|credentials)\b/i;

export function metadataHash(tool: McpToolDefinition): string {
  return stableHash(stableStringify({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));
}

export function scanMcpTool(args: {
  tool: McpToolDefinition;
  server: McpServerConfig;
  previous?: McpToolSnapshot | null;
  trustedToolNames?: string[];
}): { risk: ToolRisk; flags: McpSecurityFlag[]; metadataHash: string; approved: boolean; enabled: boolean } {
  const text = `${args.tool.name} ${args.tool.title ?? ''} ${args.tool.description ?? ''}`;
  const schemaText = stableStringify(args.tool.inputSchema ?? {});
  const flags: McpSecurityFlag[] = [];
  const add = (kind: McpSecurityFlag['kind'], severity: McpSecurityFlag['severity'], message: string) => flags.push({ kind, severity, message });

  if (SECRET.test(text) || SECRET.test(schemaText)) add('mentions_secrets', 'critical', 'Tool metadata mentions secrets, tokens, passwords, or credentials.');
  if (/\b(credentials?|auth)\b/i.test(text)) add('mentions_credentials', 'critical', 'Tool may access credentials or auth material.');
  if (NETWORK.test(text) || NETWORK.test(schemaText) || args.server.transport === 'streamable_http') add('network_access', 'warn', 'Tool or server may access network resources.');
  if (FILES.test(text) || FILES.test(schemaText)) add('filesystem_access', 'warn', 'Tool may access filesystem paths.');
  if (EXEC.test(text) || hasStringProperty(args.tool.inputSchema, 'command')) add('process_exec', 'critical', 'Tool may execute commands or processes.');
  if (DESTRUCTIVE.test(text)) add('destructive', 'critical', 'Tool appears destructive.');
  if (SEND.test(text)) add('external_send', 'critical', 'Tool appears able to send, publish, or message externally.');
  if (INJECTION.test(text)) add('prompt_injection_like', 'critical', 'Tool description contains prompt-injection-like instructions.');
  if (!args.tool.description || args.tool.description.trim().length < 12) add('ambiguous_description', 'warn', 'Tool description is missing or too vague.');
  if (schemaTooPermissive(args.tool.inputSchema)) add('schema_too_permissive', 'warn', 'Input schema allows broad arbitrary strings or additional properties.');
  if (toolShadowing(args.tool.name, args.trustedToolNames ?? [])) add('tool_shadowing_risk', 'warn', 'Tool name resembles a trusted tool but comes from an MCP server.');

  const hash = metadataHash(args.tool);
  const changed = Boolean(args.previous && args.previous.metadataHash !== hash);
  if (changed) add('metadata_changed', 'critical', 'Tool metadata changed after first discovery; approval reset is required.');

  const risk = classifyRisk(text, schemaText, flags);
  const critical = flags.some((f) => f.severity === 'critical');
  return {
    risk,
    flags,
    metadataHash: hash,
    approved: changed ? false : Boolean(args.previous?.approved) && !critical,
    enabled: args.server.trustLevel === 'untrusted' ? false : Boolean(args.previous?.enabled) || (!critical && risk === 'read_only'),
  };
}

export function classifyRisk(text: string, schemaText = '', flags: McpSecurityFlag[] = []): ToolRisk {
  if (flags.some((f) => f.kind === 'mentions_secrets' || f.kind === 'mentions_credentials') || SECRET.test(text) || SECRET.test(schemaText)) return 'credential_access';
  if (flags.some((f) => f.kind === 'process_exec') || EXEC.test(text) || hasStringPropertyFromText(schemaText, 'command')) return 'process_exec';
  if (flags.some((f) => f.kind === 'destructive') || DESTRUCTIVE.test(text)) return 'destructive';
  if (flags.some((f) => f.kind === 'external_send') || SEND.test(text)) return 'external_send';
  if (/\b(write|create|update|upload|append|patch|put)\b/i.test(text)) return NETWORK.test(text) ? 'external_write' : 'local_write';
  if (NETWORK.test(text)) return 'external_read';
  return 'read_only';
}

function schemaTooPermissive(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const obj = schema as Record<string, unknown>;
  if (obj.additionalProperties === true) return true;
  const properties = obj.properties;
  if (properties && typeof properties === 'object') {
    return Object.entries(properties as Record<string, unknown>).some(([name, prop]) => {
      const p = prop as Record<string, unknown>;
      return p?.type === 'string' && /^(command|cmd|path|url|body)$/i.test(name) && !p.enum && !p.pattern && !p.format;
    });
  }
  return false;
}

function hasStringProperty(schema: unknown, name: string): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const prop = ((schema as Record<string, unknown>).properties as Record<string, unknown> | undefined)?.[name];
  return Boolean(prop && typeof prop === 'object' && (prop as Record<string, unknown>).type === 'string');
}

function hasStringPropertyFromText(text: string, name: string): boolean {
  return new RegExp(`"${name}"\\s*:\\s*\\{[^}]*"type"\\s*:\\s*"string"`, 'i').test(text);
}

function toolShadowing(name: string, trustedNames: string[]): boolean {
  const norm = normalizeName(name);
  return trustedNames.some((trusted) => {
    const t = normalizeName(trusted);
    return norm !== t && levenshtein(norm, t) <= 2;
  });
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[0o]/g, 'o').replace(/[1l]/g, 'l').replace(/[^a-z.]/g, '');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
