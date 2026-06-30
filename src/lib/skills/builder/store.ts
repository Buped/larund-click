// Skill Builder store. Persists user/workspace skills through the shared coworker
// backend. Enforces unique skill names per scope so the compiler/runner never
// sees ambiguous overrides.

import { recordBackend, type RecordRow } from '../../coworker/persistence';
import type {
  CreateSkillBuilderInput,
  SkillBuilderPatch,
  SkillBuilderSkill,
  SkillLearningMetadata,
} from './types';

const COLLECTION = 'builder_skills';

function toSkill(row: RecordRow): SkillBuilderSkill {
  return row as unknown as SkillBuilderSkill;
}

export class DuplicateSkillNameError extends Error {
  constructor(public skillName: string) {
    super(`duplicate_skill_name:${skillName}`);
  }
}

export class WorkspaceRequiredForSkillError extends Error {
  constructor() {
    super('workspace_id_required_for_skill');
  }
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

async function nameTaken(userId: string, name: string, workspaceId?: string, exceptId?: string): Promise<boolean> {
  const existing = await listBuilderSkills({ userId, workspaceId });
  const target = slug(name);
  return existing.some((s) => s.id !== exceptId && slug(s.name) === target && (s.workspaceId ?? null) === (workspaceId ?? null));
}

export async function createBuilderSkill(input: CreateSkillBuilderInput): Promise<SkillBuilderSkill> {
  if (!input.workspaceId) {
    throw new WorkspaceRequiredForSkillError();
  }
  if (await nameTaken(input.userId, input.name, input.workspaceId)) {
    throw new DuplicateSkillNameError(input.name);
  }
  const now = new Date().toISOString();
  const learning = normalizeLearning(input.learning, now);
  const skill: SkillBuilderSkill = {
    id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    version: '1.0.0',
    description: input.description.trim(),
    source: input.source ?? (input.workspaceId ? 'workspace' : 'user'),
    status: input.status,
    checksum: input.checksum,
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    originTaskRunId: input.originTaskRunId,
    originAutomationId: input.originAutomationId,
    kind: input.kind ?? 'workflow',
    target: input.target,
    learning,
    instructionBody: input.instructionBody?.trim() || undefined,
    triggerPhrases: input.triggerPhrases ?? [],
    categories: input.categories ?? ['general'],
    whenToUse: input.whenToUse ?? [],
    whenNotToUse: input.whenNotToUse ?? [],
    requiredConnections: input.requiredConnections ?? [],
    requiredMcpServers: input.requiredMcpServers ?? [],
    allowedTools: input.allowedTools ?? [],
    riskLevel: input.riskLevel ?? 'read_only',
    steps: input.steps ?? [],
    verificationChecklist: input.verificationChecklist ?? [],
    fallbackStrategy: input.fallbackStrategy ?? 'If blocked, ask_user for a manual step or an alternative path; never use a mouse.',
    examplePrompts: input.examplePrompts ?? [],
    exampleRuns: [],
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await recordBackend().put(COLLECTION, skill as unknown as RecordRow);
  return skill;
}

export async function getBuilderSkill(id: string): Promise<SkillBuilderSkill | null> {
  const row = await recordBackend().get(COLLECTION, id);
  return row ? toSkill(row) : null;
}

export async function updateBuilderSkill(id: string, patch: SkillBuilderPatch): Promise<SkillBuilderSkill | null> {
  const existing = await getBuilderSkill(id);
  if (!existing) return null;
  if (patch.name && (await nameTaken(existing.userId, patch.name, existing.workspaceId, id))) {
    throw new DuplicateSkillNameError(patch.name);
  }
  const bumpVersion = patch.steps || patch.allowedTools || patch.verificationChecklist;
  const updated: SkillBuilderSkill = {
    ...existing,
    ...patch,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    version: bumpVersion ? bumpPatch(existing.version) : existing.version,
    updatedAt: new Date().toISOString(),
  };
  await recordBackend().put(COLLECTION, updated as unknown as RecordRow);
  return updated;
}

export async function setBuilderSkillEnabled(id: string, enabled: boolean): Promise<SkillBuilderSkill | null> {
  return updateBuilderSkill(id, { enabled });
}

export async function deleteBuilderSkill(id: string): Promise<void> {
  await recordBackend().delete(COLLECTION, id);
}

export async function listBuilderSkills(filter: {
  userId: string;
  workspaceId?: string;
  includeSuggested?: boolean;
}): Promise<SkillBuilderSkill[]> {
  const rows = await recordBackend().all(COLLECTION);
  return rows
    .map(toSkill)
    .filter((s) => s.userId === filter.userId)
    // v2 canonical storage is workspace-scoped Supabase data. Legacy user-global
    // rows are only visible when no workspace filter is provided for migration.
    .filter((s) => filter.workspaceId ? s.workspaceId === filter.workspaceId : !s.workspaceId)
    .filter((s) => filter.includeSuggested || s.source !== 'suggested')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function migrateLegacyUserSkillsToWorkspace(userId: string, workspaceId: string): Promise<SkillBuilderSkill[]> {
  if (!workspaceId) throw new WorkspaceRequiredForSkillError();
  const legacy = await listBuilderSkills({ userId, includeSuggested: true });
  const migrated: SkillBuilderSkill[] = [];
  for (const skill of legacy.filter((s) => !s.workspaceId)) {
    const targetName = await nameTaken(userId, skill.name, workspaceId)
      ? `${skill.name} legacy`
      : skill.name;
    const now = new Date().toISOString();
    const updated: SkillBuilderSkill = {
      ...skill,
      id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: targetName,
      workspaceId,
      source: skill.source === 'suggested' ? 'suggested' : 'workspace',
      kind: skill.kind ?? 'workflow',
      learning: normalizeLearning(skill.learning, now),
      updatedAt: now,
    };
    await recordBackend().put(COLLECTION, updated as unknown as RecordRow);
    await recordBackend().delete(COLLECTION, skill.id);
    migrated.push(updated);
  }
  return migrated;
}

function normalizeLearning(input: Partial<SkillLearningMetadata> | undefined, now: string): SkillLearningMetadata | undefined {
  if (!input) return undefined;
  return {
    originTaskRunIds: input.originTaskRunIds ?? [],
    autoLearned: input.autoLearned ?? false,
    confidence: input.confidence ?? 0,
    promotedAt: input.promotedAt,
    lastUsedAt: input.lastUsedAt ?? now,
    usageCount: input.usageCount ?? 0,
    successCount: input.successCount ?? 0,
    failureCount: input.failureCount ?? 0,
  };
}

function bumpPatch(version: string): string {
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}
