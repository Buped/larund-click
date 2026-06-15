// Skill Builder test-runner (MVP). A NON-DESTRUCTIVE dry run: validates the
// skill, checks required connections are available, checks allowed tools exist,
// and renders the plan the agent would follow. Actual execution is out of scope
// here and must go through the normal approval-gated agent loop.

import { TOOL_CATALOG } from '../../tools/registry';
import { compileToMarkdown, validateBuilderSkill } from './compiler';
import type { SkillBuilderSkill } from './types';

export interface DryRunInput {
  /** Connection ids configured/enabled for the workspace. */
  availableConnectionIds?: string[];
  /** Example prompt to render the plan against. */
  prompt?: string;
}

export interface DryRunResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  missingConnections: string[];
  unknownTools: string[];
  renderedPlan: string;
  /** Always true: real execution requires user approval via the agent loop. */
  requiresApprovalToExecute: boolean;
}

export function dryRunSkill(skill: SkillBuilderSkill, input: DryRunInput = {}): DryRunResult {
  const knownTools: string[] = TOOL_CATALOG.map((t) => t.name);
  const validation = validateBuilderSkill(skill, knownTools);

  const available = new Set(input.availableConnectionIds ?? []);
  const missingConnections = skill.requiredConnections.filter((c) => !available.has(c));
  const unknownTools = skill.allowedTools.filter((t) => !knownTools.includes(t));

  const warnings = [...validation.warnings];
  if (missingConnections.length) {
    warnings.push(`Required connections not configured: ${missingConnections.join(', ')}. The agent will hit a clear "missing auth" blocker.`);
  }

  const planHeader = input.prompt ? `Plan for: "${input.prompt}"\n\n` : '';
  const renderedPlan = planHeader + compileToMarkdown(skill);

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings,
    missingConnections,
    unknownTools,
    renderedPlan,
    requiresApprovalToExecute: true,
  };
}
