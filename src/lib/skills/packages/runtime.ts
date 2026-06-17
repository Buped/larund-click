import type { SkillPackage, SkillPackageSummary } from './types';
import { getSkillPackage, listSkillPackages } from './store';

export function summarizeSkillPackage(skill: SkillPackage): SkillPackageSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggerPhrases: skill.triggerPhrases,
    requiredConnections: skill.requiredConnections,
    riskLevel: skill.riskLevel,
    source: skill.source,
    enabled: skill.enabled,
  };
}

export async function listSkillPackageSummaries(args: { userId: string; workspaceId?: string }): Promise<SkillPackageSummary[]> {
  return (await listSkillPackages(args)).map(summarizeSkillPackage);
}

export async function loadFullSkillPackage(id: string, args: { userId: string; workspaceId?: string }): Promise<SkillPackage | null> {
  return getSkillPackage(id, args);
}

export function renderSkillPackageForAgent(skill: SkillPackage): string {
  return [
    `## Skill: ${skill.name}`,
    `id: ${skill.id}`,
    `source: ${skill.source}`,
    `version: ${skill.version}`,
    `risk: ${skill.riskLevel}`,
    skill.requiredConnections.length ? `required connections: ${skill.requiredConnections.join(', ')}` : 'required connections: none',
    skill.requiredMcpServers.length ? `required MCP servers: ${skill.requiredMcpServers.join(', ')}` : '',
    skill.allowedTools.length ? `allowed tools: ${skill.allowedTools.join(', ')}` : '',
    '',
    '### When to use',
    skill.whenToUse.map((x) => `- ${x}`).join('\n') || '- When selected or explicitly mentioned.',
    '',
    '### When not to use',
    skill.whenNotToUse.map((x) => `- ${x}`).join('\n') || '- When the task target or available tools do not match.',
    '',
    '### Full instructions',
    skill.instructionBody,
    '',
    '### Steps',
    skill.steps.map((s, i) => `${i + 1}. [${s.required ? 'required' : 'optional'}] ${s.title}: ${s.instruction}${s.preferredTools.length ? ` (tools: ${s.preferredTools.join(', ')})` : ''}`).join('\n') || '- Plan, act, verify.',
    '',
    '### Verification checklist',
    skill.verificationChecklist.map((v) => `- [${v.required ? 'required' : 'optional'}] ${v.title} (${v.kind})${v.description ? `: ${v.description}` : ''}`).join('\n') || '- Read back the result before task.complete.',
    '',
    '### Examples',
    skill.examples.map((e) => `- ${e.title}: user says "${e.userPrompt}" -> ${e.expectedBehavior}`).join('\n') || '- Follow the skill instructions and verify before completing.',
  ].filter(Boolean).join('\n');
}
