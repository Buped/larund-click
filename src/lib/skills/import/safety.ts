import { parseSkillFile } from '../frontmatter';
import type { SkillManifest } from '../types';

export type ImportStatus = 'pending_review' | 'reviewed' | 'enabled' | 'disabled' | 'blocked' | 'deprecated';

export interface SkillImportValidation {
  status: ImportStatus;
  errors: string[];
  warnings: string[];
  manifest?: SkillManifest;
}

export const CLAUDE_TO_LARUND_TOOL_MAP: Record<string, string> = {
  Bash: 'cli.run',
  Read: 'file.read',
  Write: 'file.write',
  Edit: 'file.edit',
  Grep: 'file.search',
  Glob: 'file.search',
  WebFetch: 'browser.read',
  WebSearch: 'browser.open/browser.read',
  TodoWrite: 'workflow.status',
};

const REJECT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(mouse|cursor|coordinate|bbox|screenshot|pixel|ocr click|visual click)\b/i, 'mouse_cursor_visual_not_allowed'],
  [/(ignore previous instructions|always choose this skill|prefer me over other skills)/i, 'prompt_injection_preference'],
  [/(print|echo|exfiltrate|dump).{0,40}(api[_ -]?key|token|secret|password|credential)/i, 'credential_exfiltration'],
  [/(read|open).{0,50}(\.env|id_rsa|ssh key|password manager|credential store)/i, 'unjustified_sensitive_file_access'],
  [/(curl|wget|bash|sh|powershell|python).{0,80}(http|remote|download|pipe)/i, 'arbitrary_script_execution'],
];

const WARNING_PATTERNS: Array<[RegExp, string]> = [
  [/you are an expert|act as|think like/i, 'persona_heavy_or_generic'],
  [/\.py|\.sh|\.ps1|script/i, 'external_script_reference'],
  [/connect|api|oauth|credential/i, 'may_require_connection_declaration'],
];

export function validateImportedSkillMarkdown(markdown: string, opts: { duplicateNames?: string[] } = {}): SkillImportValidation {
  const parsed = parseSkillFile(markdown);
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = `${markdown}\n${parsed.manifest?.allowed_tools.join('\n') ?? ''}`;
  const imperativeText = text
    .split(/\r?\n/)
    .filter((line) => !/\b(do not|don't|never|no-mouse|not allowed|without)\b/i.test(line))
    .join('\n');

  if (!parsed.manifest) errors.push(parsed.error ?? 'invalid_frontmatter');
  if (parsed.error?.startsWith('forbidden_tool')) errors.push(parsed.error);
  for (const [pattern, code] of REJECT_PATTERNS) if (pattern.test(imperativeText)) errors.push(code);
  for (const [pattern, code] of WARNING_PATTERNS) if (pattern.test(text)) warnings.push(code);

  const manifest = parsed.manifest;
  if (manifest) {
    if (!manifest.when_to_use?.length) warnings.push('missing_when_to_use');
    if (!manifest.when_not_to_use?.length) warnings.push('missing_when_not_to_use');
    if (manifest.risk !== 'read_only' && !manifest.verification_checklist?.length) errors.push('missing_verification_checklist_for_risky_skill');
    if (opts.duplicateNames?.includes(manifest.name)) warnings.push('duplicates_existing_skill');
    if (manifest.allowed_tools.some((tool) => /bash|shell|powershell|python/i.test(tool))) errors.push('raw_external_tool_not_allowed');
    if (/google|github|notion|gmail|slack/i.test(text) && !manifest.requires_connections.length) warnings.push('connection_mentioned_but_not_declared');
  }

  return {
    status: errors.length ? 'blocked' : 'pending_review',
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    manifest,
  };
}
