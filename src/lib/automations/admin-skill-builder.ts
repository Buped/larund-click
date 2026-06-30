import { callOpenRouterJson } from '../openrouter';
import { TOOL_CATALOG } from '../tools/registry';
import type { ToolRisk } from '../control-system/types';
import type { Automation } from './types';
import { dryRunSkill, type DryRunResult } from '../skills/builder/test-runner';
import { listBuilderSkills } from '../skills/builder/store';
import { listSharedSkills } from '../skills/shared-store';
import { checksum as checksumValue } from '../skill-packages/package';
import type { SkillBuilderKind, SkillBuilderSkill, SkillStep, VerificationCheck } from '../skills/builder/types';

const ADMIN_BUILDER_MODEL = 'google/gemini-3.1-flash-lite';
const RISKS = new Set<ToolRisk>(['read_only', 'local_write', 'external_read', 'external_write', 'external_send', 'destructive', 'credential_access', 'process_exec']);
const VERIFY_KINDS = new Set<VerificationCheck['kind']>(['read_back', 'assert_text', 'file_exists', 'connection_read', 'test_run', 'manual_review', 'custom']);

export interface AdminSkillDraft {
  skill: SkillBuilderSkill;
  dryRun: DryRunResult;
  proposedScope: 'workspace' | 'global';
  warnings: string[];
}

interface SkillDraftJson {
  skills?: unknown;
  warnings?: unknown;
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clean(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, 240)).filter((item): item is string => Boolean(item));
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
}

function risk(value: unknown, tools: string[]): ToolRisk {
  if (typeof value === 'string' && RISKS.has(value as ToolRisk)) return value as ToolRisk;
  if (tools.some((tool) => /delete|kill|remove/.test(tool))) return 'destructive';
  if (tools.some((tool) => /email\.compose/.test(tool))) return 'external_send';
  if (tools.some((tool) => /^connection\.|browser\.(type|click|paste|upload|key|shortcut)/.test(tool))) return 'external_write';
  if (tools.some((tool) => /write|mkdir|move|copy|append|download|upload|render|format|chart|table/.test(tool))) return 'local_write';
  if (tools.some((tool) => /cli\.run|process\.|code\./.test(tool))) return 'process_exec';
  if (tools.some((tool) => /^browser\.|^web\.|^connection\./.test(tool))) return 'external_read';
  return 'read_only';
}

function normalizeSteps(raw: unknown): SkillStep[] {
  return objectList(raw).slice(0, 10).map((item, index) => ({
    id: clean(item.id, 80) ?? `step-${index + 1}`,
    title: clean(item.title, 100) ?? `Step ${index + 1}`,
    instruction: clean(item.instruction, 900) ?? clean(item.description, 900) ?? 'Follow the reusable workflow step and verify before continuing.',
    preferredTools: list(item.preferredTools ?? item.tools),
    required: item.required !== false,
    verificationHint: clean(item.verificationHint, 240),
  }));
}

function normalizeVerification(raw: unknown): VerificationCheck[] {
  return objectList(raw).slice(0, 8).map((item, index) => {
    const kind = typeof item.kind === 'string' && VERIFY_KINDS.has(item.kind as VerificationCheck['kind'])
      ? item.kind as VerificationCheck['kind']
      : 'read_back';
    const title = clean(item.title, 140) ?? `Verification ${index + 1}`;
    return {
      id: clean(item.id, 80) ?? `v-${index + 1}`,
      title,
      description: clean(item.description, 400) ?? title,
      kind,
      required: item.required !== false,
      config: typeof item.config === 'object' && item.config !== null ? item.config as Record<string, unknown> : undefined,
    };
  });
}

function extractJson(raw: string): SkillDraftJson {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as SkillDraftJson : {};
  } catch {
    return {};
  }
}

function slugName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function shortAutomationName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).slice(0, 4).join(' ') || 'automation';
}

function checksumSkill(skill: SkillBuilderSkill): string {
  return checksumValue({
    name: skill.name,
    version: skill.version,
    description: skill.description,
    allowedTools: skill.allowedTools,
    requiredConnections: skill.requiredConnections,
    requiredMcpServers: skill.requiredMcpServers,
    steps: skill.steps,
    verificationChecklist: skill.verificationChecklist,
    fallbackStrategy: skill.fallbackStrategy,
    instructionBody: skill.instructionBody,
  });
}

function normalizeDraft(raw: Record<string, unknown>, args: {
  userId: string;
  workspaceId?: string;
  automation: Automation;
  existingNames: Set<string>;
}): { skill: SkillBuilderSkill; proposedScope: 'workspace' | 'global'; warnings: string[] } {
  const warnings: string[] = [];
  const knownTools = new Set(TOOL_CATALOG.map((tool) => tool.name));
  const requestedTools = list(raw.allowedTools).filter(Boolean);
  const allowedTools = requestedTools.length ? requestedTools : ['skill.run'];
  const unknown = allowedTools.filter((tool) => !knownTools.has(tool as typeof TOOL_CATALOG[number]['name']));
  if (unknown.length) warnings.push(`Unknown tools from model: ${unknown.join(', ')}`);
  const baseName = clean(raw.name, 80) ?? `${args.automation.name} workflow`;
  const nameKey = slugName(baseName);
  const name = args.existingNames.has(nameKey)
    ? `${baseName} (${shortAutomationName(args.automation.name)})`
    : baseName;
  if (name !== baseName) warnings.push(`Duplicate skill name adjusted from "${baseName}" to "${name}".`);
  args.existingNames.add(slugName(name));
  const source = 'admin_authored' as const;
  const steps = normalizeSteps(raw.steps);
  const verificationChecklist = normalizeVerification(raw.verificationChecklist);
  const createdAt = new Date().toISOString();
  const automationConnections = (args.automation.taskTemplate.requiredConnectionIds ?? []).filter((item): item is string => typeof item === 'string' && Boolean(item));
  const skill: SkillBuilderSkill = {
    id: nowId('admin-skill'),
    name,
    version: clean(raw.version, 30) ?? '1.0.0',
    description: clean(raw.description, 300) ?? `Reusable skill generated from automation: ${args.automation.name}`,
    userId: args.userId,
    workspaceId: args.workspaceId,
    source,
    status: 'pending_review',
    kind: (raw.kind === 'app_profile' ? 'app_profile' : 'workflow') as SkillBuilderKind,
    target: typeof raw.target === 'object' && raw.target !== null ? raw.target as SkillBuilderSkill['target'] : undefined,
    instructionBody: clean(raw.instructionBody, 5000),
    triggerPhrases: list(raw.triggerPhrases).length ? list(raw.triggerPhrases) : [args.automation.name],
    categories: list(raw.categories).length ? list(raw.categories) : ['automation', 'admin-authored'],
    whenToUse: list(raw.whenToUse).length ? list(raw.whenToUse) : [`Use when the user asks for the reusable workflow behind ${args.automation.name}.`],
    whenNotToUse: list(raw.whenNotToUse).length ? list(raw.whenNotToUse) : ['Do not use if the target app, source data, or requested output differs materially from this automation.'],
    requiredConnections: [...new Set([...list(raw.requiredConnections), ...automationConnections])],
    requiredMcpServers: list(raw.requiredMcpServers),
    allowedTools,
    riskLevel: risk(raw.riskLevel, allowedTools),
    steps,
    verificationChecklist: verificationChecklist.length ? verificationChecklist : [{ id: 'v-read-back', title: 'Result was read back', description: 'Read back the output or target state before completion.', kind: 'read_back', required: true }],
    fallbackStrategy: clean(raw.fallbackStrategy, 1000) ?? 'If blocked, ask_user for clarification or a manual step; never bypass approval or use mouse/pixel automation.',
    examplePrompts: list(raw.examplePrompts).length ? list(raw.examplePrompts) : [args.automation.prompt ?? args.automation.name],
    exampleRuns: [],
    enabled: false,
    createdAt,
    updatedAt: createdAt,
    originAutomationId: args.automation.id,
  };
  skill.checksum = checksumSkill(skill);
  return {
    skill,
    proposedScope: raw.proposedScope === 'global' ? 'global' : 'workspace',
    warnings,
  };
}

export async function generateAdminSkillDrafts(args: {
  userId: string;
  workspaceId?: string;
  adminText: string;
  automation: Automation;
  availableConnectionIds?: string[];
}): Promise<{ drafts: AdminSkillDraft[]; warnings: string[] }> {
  const warnings: string[] = [];
  const existing = await listBuilderSkills({ userId: args.userId, workspaceId: args.workspaceId, includeSuggested: true }).catch(() => []);
  const shared = await listSharedSkills({ userId: args.userId, workspaceId: args.workspaceId, includePending: true }).catch(() => []);
  const existingNames = new Set([...existing.map((skill) => slugName(skill.name)), ...shared.map((skill) => slugName(skill.name))]);
  try {
    const { content } = await callOpenRouterJson(
      [
        {
          role: 'system',
          content: [
            'You generate reusable Larund SkillBuilderSkill drafts for an admin-created automation.',
            'Return ONLY minified JSON: {"skills":[...],"warnings":[...]}.',
            'Each skill must include name, description, triggerPhrases, categories, allowedTools, requiredConnections, requiredMcpServers, riskLevel, steps, verificationChecklist, fallbackStrategy, examplePrompts, proposedScope.',
            `allowedTools must only use these known tools: ${TOOL_CATALOG.map((tool) => tool.name).join(', ')}`,
            'Never include secrets, passwords, API keys, user tokens, or credential values.',
            'A skill is instruction only. It must never claim to bypass approval, risk policy, login, captcha, or manual review.',
            'Prefer one reusable workflow skill. Add a second app_profile skill only when there is a clearly reusable target app/site profile.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            adminText: args.adminText,
            automation: {
              id: args.automation.id,
              name: args.automation.name,
              description: args.automation.description,
              prompt: args.automation.prompt,
              steps: args.automation.steps,
              verificationChecklist: args.automation.verificationChecklist,
              requiredConnectionIds: args.automation.taskTemplate.requiredConnectionIds,
              referencedContext: args.automation.referencedContext?.map((ref) => ({ kind: ref.kind, label: ref.label, refId: ref.refId })),
            },
          }),
        },
      ],
      ADMIN_BUILDER_MODEL,
      args.userId,
      true,
    );
    const parsed = extractJson(content);
    warnings.push(...list(parsed.warnings).map((warning) => `AI skill builder warning: ${warning}`));
    const rawSkills = objectList(parsed.skills);
    const drafts = rawSkills.slice(0, 3).map((raw) => {
      const normalized = normalizeDraft(raw, {
        userId: args.userId,
        workspaceId: args.workspaceId,
        automation: args.automation,
        existingNames,
      });
      const dryRun = dryRunSkill(normalized.skill, {
        availableConnectionIds: args.availableConnectionIds,
        prompt: args.automation.prompt,
      });
      return {
        ...normalized,
        dryRun,
        warnings: [...normalized.warnings, ...dryRun.warnings],
      };
    });
    if (!drafts.length) warnings.push('AI skill builder returned no reusable skill drafts.');
    return { drafts, warnings };
  } catch (error) {
    return {
      drafts: [],
      warnings: [`AI skill draft unavailable: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
