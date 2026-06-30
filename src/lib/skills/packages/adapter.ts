import type { Skill } from '../types';
import type { SkillBuilderSkill, VerificationCheck as BuilderVerificationCheck } from '../builder/types';
import type { RichSkillManifest } from '../manifest';
import { toRichManifest } from '../manifest';
import type { SkillPackage, SkillPackageSource, VerificationCheck, VerificationKind } from './types';

const NOW = '2026-01-01T00:00:00.000Z';

function sourceFromRich(source: RichSkillManifest['source']): SkillPackageSource {
  if (source === 'bundled') return 'built_in';
  if (source === 'marketplace') return 'imported';
  return source;
}

function verificationKindFromText(text: string): VerificationKind {
  const t = text.toLowerCase();
  if (/file.*exist/.test(t)) return 'file_exists';
  if (/sheet|values/.test(t)) return 'sheet_values_match';
  if (/doc|document/.test(t)) return 'doc_read_back';
  if (/manual|approval|review/.test(t)) return 'manual_review';
  if (/read back|read-back|readback/.test(t)) return 'read_back';
  return 'custom';
}

function normalizeBuilderVerification(v: BuilderVerificationCheck): VerificationCheck {
  const map: Record<BuilderVerificationCheck['kind'], VerificationKind> = {
    read_back: 'read_back',
    assert_text: 'contains_text',
    file_exists: 'file_exists',
    connection_read: 'connection_read_back',
    test_run: 'custom',
    manual_review: 'manual_review',
    custom: 'custom',
  };
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    kind: map[v.kind] ?? 'custom',
    required: v.required,
    config: v.config,
  };
}

export function skillToPackage(skill: Skill): SkillPackage {
  const rich = toRichManifest(skill);
  return {
    id: rich.id,
    name: rich.name,
    version: rich.version,
    description: rich.description,
    source: sourceFromRich(rich.source),
    kind: rich.kind,
    target: rich.target as SkillPackage['target'],
    learning: rich.learning as SkillPackage['learning'],
    categories: rich.categories,
    triggerPhrases: rich.trigger,
    whenToUse: rich.whenToUse.length ? rich.whenToUse : defaultWhenToUse(rich.name, rich.categories),
    whenNotToUse: rich.whenNotToUse.length ? rich.whenNotToUse : defaultWhenNotToUse(rich.name, rich.requiredConnections),
    requiredConnections: rich.requiredConnections,
    requiredMcpServers: rich.requiredMcpServers,
    allowedTools: rich.allowedTools,
    riskLevel: rich.risk,
    instructionBody: skill.body.trim(),
    steps: extractSteps(skill.body),
    verificationChecklist: rich.verificationChecklist.map((title, index) => ({
      id: `v-${index}`,
      title,
      kind: verificationKindFromText(title),
      required: true,
    })),
    examples: defaultExamples(rich.name),
    assets: [],
    enabled: skill.enabled && rich.enabledByDefault,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function builderSkillToPackage(skill: SkillBuilderSkill): SkillPackage {
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    source: skill.source,
    workspaceId: skill.workspaceId,
    status: skill.status,
    checksum: skill.checksum,
    approvedAt: skill.approvedAt,
    approvedBy: skill.approvedBy,
    originTaskRunId: skill.originTaskRunId,
    originAutomationId: skill.originAutomationId,
    kind: skill.kind ?? 'workflow',
    target: skill.target,
    learning: skill.learning,
    categories: skill.categories,
    triggerPhrases: skill.triggerPhrases,
    whenToUse: skill.whenToUse,
    whenNotToUse: skill.whenNotToUse,
    requiredConnections: skill.requiredConnections,
    requiredMcpServers: skill.requiredMcpServers,
    allowedTools: skill.allowedTools,
    riskLevel: skill.riskLevel,
    instructionBody: skill.instructionBody?.trim() || [
      `# ${skill.name}`,
      skill.description,
      '',
      '## Process',
      skill.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.instruction}`).join('\n') || 'Plan the work and verify the result.',
    ].join('\n'),
    steps: skill.steps.map((s) => ({
      id: s.id,
      title: s.title,
      instruction: s.instruction,
      required: s.required,
      preferredTools: s.preferredTools,
      referencedContext: [],
    })),
    verificationChecklist: skill.verificationChecklist.map(normalizeBuilderVerification),
    examples: skill.examplePrompts.map((prompt, index) => ({
      id: `ex-${index}`,
      title: `Example ${index + 1}`,
      userPrompt: prompt,
      expectedBehavior: skill.exampleRuns[index] ?? 'Follow the skill instructions and verify the output before completing.',
    })),
    assets: [],
    enabled: skill.enabled,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function extractSteps(body: string) {
  const lines = body.split(/\r?\n/);
  return lines
    .map((line, index) => {
      const match = line.match(/^\s*(?:\d+\.|-)\s+(.+)/);
      if (!match) return null;
      const [title, ...rest] = match[1].split(':');
      return {
        id: `step-${index}`,
        title: title.trim().slice(0, 80),
        instruction: (rest.join(':').trim() || match[1].trim()),
        required: true,
        preferredTools: [],
        referencedContext: [],
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .slice(0, 12);
}

function defaultWhenToUse(name: string, categories: string[]): string[] {
  return [
    `Use ${name} when the user's task clearly matches ${categories.join(', ') || 'this workflow'}.`,
    'Use it when the task needs repeatable procedure, explicit tool choices, and verification evidence.',
  ];
}

function defaultWhenNotToUse(name: string, requiredConnections: string[]): string[] {
  const out = [`Do not use ${name} when the user only wants a quick explanation or brainstorming.`];
  if (requiredConnections.length) out.push(`Do not use it for live external work until ${requiredConnections.join(', ')} is configured or the user approves a fallback.`);
  out.push('Do not use any mouse, cursor, screenshot, OCR-click, or pixel-control path.');
  return out;
}

function defaultExamples(name: string) {
  return [
    {
      id: 'ex-1',
      title: 'Direct request',
      userPrompt: `Use @${name} for this task.`,
      expectedBehavior: 'Load the full skill package, follow its steps, and satisfy its verification checklist before completion.',
    },
  ];
}
