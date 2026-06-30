// Skill Builder compiler. Converts a structured SkillBuilderSkill into the exact
// SKILL.md frontmatter + body the existing parser/runner consume, then into a
// runtime `Skill`. Custom skills therefore use the same execution + verification
// path as bundled ones — no parallel runtime.

import type { Skill, SkillSource } from '../types';
import { loadSkillFromMarkdown } from '../loader';
import type { SkillBuilderSkill, SkillBuilderSource } from './types';

function yamlList(items: string[]): string {
  return `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;
}

function mapSource(source: SkillBuilderSource): SkillSource {
  switch (source) {
    case 'admin_authored':
    case 'self_learned':
    case 'workspace':
      return 'workspace';
    case 'imported':
    case 'suggested':
    case 'user':
    default:
      return 'user';
  }
}

/** Compile to the SKILL.md markdown string (frontmatter + body). */
export function compileToMarkdown(skill: SkillBuilderSkill): string {
  const fm = [
    '---',
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    `version: ${JSON.stringify(skill.version)}`,
    `allowed_tools: ${yamlList(skill.allowedTools)}`,
    `requires_connections: ${yamlList(skill.requiredConnections)}`,
    `required_mcp_servers: ${yamlList(skill.requiredMcpServers)}`,
    `risk: ${JSON.stringify(skill.riskLevel)}`,
    `categories: ${yamlList(skill.categories)}`,
    `trigger: ${JSON.stringify(skill.triggerPhrases.join(' '))}`,
    `when_to_use: ${yamlList(skill.whenToUse)}`,
    `when_not_to_use: ${yamlList(skill.whenNotToUse)}`,
    `verification_checklist: ${yamlList(skill.verificationChecklist.map((v) => v.title))}`,
    `enabled_by_default: ${skill.enabled ? 'true' : 'false'}`,
    '---',
  ].join('\n');

  const stepLines = skill.steps.length
    ? skill.steps
        .map((s, i) => {
          const tools = s.preferredTools.length ? ` (tools: ${s.preferredTools.join(', ')})` : '';
          const req = s.required ? '' : ' [optional]';
          const verify = s.verificationHint ? ` — verify: ${s.verificationHint}` : '';
          return `${i + 1}. ${s.title}${req}: ${s.instruction}${tools}${verify}`;
        })
        .join('\n')
    : '1. Plan the work, then execute with the allowed tools and verify before completing.';

  const checklist = skill.verificationChecklist.length
    ? skill.verificationChecklist.map((v) => `- [${v.required ? 'required' : 'optional'}] ${v.title} (${v.kind}): ${v.description}`).join('\n')
    : '- Read back the produced result with an appropriate tool before task.complete.';

  const body = [
    `# ${skill.name}`,
    skill.description,
    '',
    // The long-form instruction body (if provided) is the heart of the skill —
    // skill.run returns the full body so the agent follows it verbatim.
    ...(skill.instructionBody?.trim() ? ['## Instructions', skill.instructionBody.trim(), ''] : []),
    '## Steps',
    stepLines,
    '',
    '## Verification (all required checks must pass before task.complete)',
    checklist,
    '',
    '## Fallback',
    skill.fallbackStrategy,
  ].join('\n');

  return `${fm}\n\n${body}`;
}

/** Compile straight to a runtime `Skill` (validated through the parser). */
export function compileToSkill(skill: SkillBuilderSkill): Skill {
  const runtime = loadSkillFromMarkdown(compileToMarkdown(skill), mapSource(skill.source));
  runtime.manifest.metadata = {
    ...(runtime.manifest.metadata ?? {}),
    kind: skill.kind ?? 'workflow',
    target: skill.target,
    learning: skill.learning,
    builderSkillId: skill.id,
    workspaceId: skill.workspaceId,
  };
  return runtime;
}

export interface CompileValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_RISKS = new Set([
  'read_only', 'local_write', 'external_read', 'external_write',
  'external_send', 'destructive', 'credential_access', 'process_exec',
]);

/** Static validation before saving/installing a skill. */
export function validateBuilderSkill(skill: SkillBuilderSkill, knownTools: string[]): CompileValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!skill.name.trim()) errors.push('Name is required.');
  if (!skill.description.trim()) errors.push('Description is required.');
  if (!VALID_RISKS.has(skill.riskLevel)) errors.push(`Invalid risk level: ${skill.riskLevel}`);

  const known = new Set(knownTools);
  const unknownTools = skill.allowedTools.filter((t) => !known.has(t));
  if (unknownTools.length) warnings.push(`Unknown tools (ignored at runtime): ${unknownTools.join(', ')}`);

  // Reject any mouse/visual tool outright — Larund is no-mouse.
  const mousey = skill.allowedTools.filter((t) => /mouse|cursor|click_visual|pixel|screenshot/i.test(t));
  if (mousey.length) errors.push(`Mouse/visual tools are not allowed: ${mousey.join(', ')}`);

  if (skill.steps.length === 0) warnings.push('No steps defined — the agent will improvise within allowed tools.');
  if (skill.verificationChecklist.length === 0) warnings.push('No verification checklist — relying on the global completion guard.');

  // Compile must parse cleanly.
  const compiled = compileToSkill(skill);
  if (compiled.error) errors.push(`Compile error: ${compiled.error}`);

  return { ok: errors.length === 0, errors, warnings };
}
