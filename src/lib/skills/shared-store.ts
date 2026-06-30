import { recordBackend, type RecordRow } from '../coworker/persistence';
import { checksum as checksumValue } from '../skill-packages/package';
import type { SkillBuilderSkill, SkillBuilderSource, SkillReviewStatus } from './builder/types';

const CACHE = 'shared_skill_cache';

export type SharedSkillSource = Extract<SkillBuilderSource, 'admin_authored' | 'self_learned' | 'user' | 'workspace' | 'imported' | 'suggested'>;
export type SharedSkillStatus = SkillReviewStatus;

export interface SharedSkillRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SharedSkillSource;
  status: SharedSkillStatus;
  riskLevel: string;
  allowedTools: string[];
  requiredConnections: string[];
  requiredMcpServers: string[];
  manifestJson: SkillBuilderSkill;
  createdBy: string;
  workspaceId?: string;
  checksum: string;
  originAutomationId?: string;
  originTaskRunId?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSkillForReviewInput {
  skill: SkillBuilderSkill;
  source: SharedSkillSource;
  userId?: string;
  workspaceId?: string;
  status?: SharedSkillStatus;
  originAutomationId?: string;
  originTaskRunId?: string;
}

type SupabaseLike = {
  from(table: string): {
    select(columns?: string): unknown;
    insert(value: unknown): unknown;
    upsert(value: unknown, opts?: unknown): unknown;
    update(value: unknown): unknown;
  };
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
};

async function supabaseClient(): Promise<SupabaseLike | null> {
  try {
    const mod = await import('../supabase');
    return mod.supabase as unknown as SupabaseLike;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function skillChecksum(skill: SkillBuilderSkill): string {
  return checksumValue({
    name: skill.name,
    version: skill.version,
    description: skill.description,
    source: skill.source,
    kind: skill.kind,
    target: skill.target,
    triggerPhrases: skill.triggerPhrases,
    categories: skill.categories,
    whenToUse: skill.whenToUse,
    whenNotToUse: skill.whenNotToUse,
    requiredConnections: skill.requiredConnections,
    requiredMcpServers: skill.requiredMcpServers,
    allowedTools: skill.allowedTools,
    riskLevel: skill.riskLevel,
    instructionBody: skill.instructionBody,
    steps: skill.steps,
    verificationChecklist: skill.verificationChecklist,
    fallbackStrategy: skill.fallbackStrategy,
    examplePrompts: skill.examplePrompts,
  });
}

function fromRemote(row: Record<string, unknown>, fallbackUserId?: string): SharedSkillRecord {
  const manifest = (row.manifest_json ?? row.manifestJson ?? {}) as Partial<SkillBuilderSkill>;
  const id = String(row.id ?? manifest.id ?? `shared-${Date.now()}`);
  const workspaceId = typeof row.workspace_id === 'string' ? row.workspace_id : typeof row.workspaceId === 'string' ? row.workspaceId : undefined;
  const createdBy = String(row.created_by ?? row.createdBy ?? manifest.userId ?? fallbackUserId ?? '');
  const now = new Date().toISOString();
  const skill: SkillBuilderSkill = {
    id,
    userId: createdBy,
    workspaceId,
    name: String(manifest.name ?? row.name ?? 'Shared skill'),
    version: String(row.version ?? manifest.version ?? '1.0.0'),
    description: String(row.description ?? manifest.description ?? ''),
    source: (row.source ?? manifest.source ?? 'workspace') as SkillBuilderSource,
    status: (row.status ?? manifest.status ?? 'pending_review') as SharedSkillStatus,
    checksum: String(row.checksum ?? manifest.checksum ?? ''),
    approvedAt: typeof row.approved_at === 'string' ? row.approved_at : manifest.approvedAt,
    approvedBy: typeof row.approved_by === 'string' ? row.approved_by : manifest.approvedBy,
    originAutomationId: typeof row.origin_automation_id === 'string' ? row.origin_automation_id : manifest.originAutomationId,
    originTaskRunId: typeof row.origin_task_run_id === 'string' ? row.origin_task_run_id : manifest.originTaskRunId,
    kind: manifest.kind ?? 'workflow',
    target: manifest.target,
    learning: manifest.learning,
    instructionBody: manifest.instructionBody,
    triggerPhrases: manifest.triggerPhrases ?? [],
    categories: manifest.categories ?? ['shared'],
    whenToUse: manifest.whenToUse ?? [],
    whenNotToUse: manifest.whenNotToUse ?? [],
    requiredConnections: manifest.requiredConnections ?? [],
    requiredMcpServers: manifest.requiredMcpServers ?? [],
    allowedTools: manifest.allowedTools ?? [],
    riskLevel: manifest.riskLevel ?? 'read_only',
    steps: manifest.steps ?? [],
    verificationChecklist: manifest.verificationChecklist ?? [],
    fallbackStrategy: manifest.fallbackStrategy ?? 'If blocked, ask_user for a manual step or an alternative path; never use a mouse.',
    examplePrompts: manifest.examplePrompts ?? [],
    exampleRuns: manifest.exampleRuns ?? [],
    enabled: manifest.enabled ?? true,
    createdAt: String(row.created_at ?? manifest.createdAt ?? now),
    updatedAt: String(row.updated_at ?? manifest.updatedAt ?? now),
  };
  const sum = String(row.checksum ?? manifest.checksum ?? skillChecksum(skill));
  skill.checksum = sum;
  return {
    id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    source: skill.source as SharedSkillSource,
    status: skill.status ?? 'pending_review',
    riskLevel: skill.riskLevel,
    allowedTools: skill.allowedTools,
    requiredConnections: skill.requiredConnections,
    requiredMcpServers: skill.requiredMcpServers,
    manifestJson: skill,
    createdBy,
    workspaceId,
    checksum: sum,
    originAutomationId: skill.originAutomationId,
    originTaskRunId: skill.originTaskRunId,
    approvedBy: skill.approvedBy,
    approvedAt: skill.approvedAt,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function toRemote(input: SaveSkillForReviewInput, status: SharedSkillStatus, id?: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const sum = skillChecksum(input.skill);
  const skill: SkillBuilderSkill = {
    ...input.skill,
    id: id ?? input.skill.id,
    userId: input.userId ?? input.skill.userId,
    workspaceId: input.workspaceId ?? input.skill.workspaceId,
    source: input.source,
    status,
    checksum: sum,
    originAutomationId: input.originAutomationId ?? input.skill.originAutomationId,
    originTaskRunId: input.originTaskRunId ?? input.skill.originTaskRunId,
    updatedAt: now,
  };
  return {
    name: slug(skill.name),
    version: skill.version,
    description: skill.description,
    source: input.source,
    status,
    risk_level: skill.riskLevel,
    allowed_tools: skill.allowedTools,
    required_connections: skill.requiredConnections,
    required_mcp_servers: skill.requiredMcpServers,
    manifest_json: skill,
    created_by: input.userId ?? skill.userId,
    workspace_id: input.workspaceId ?? skill.workspaceId ?? null,
    checksum: sum,
    origin_automation_id: input.originAutomationId ?? skill.originAutomationId ?? null,
    origin_task_run_id: input.originTaskRunId ?? skill.originTaskRunId ?? null,
  };
}

async function cacheRecord(record: SharedSkillRecord): Promise<void> {
  await recordBackend().put(CACHE, {
    ...record,
    id: record.id,
  } as unknown as RecordRow);
}

async function listCached(args: { userId?: string; workspaceId?: string; includePending?: boolean }): Promise<SharedSkillRecord[]> {
  const rows = await recordBackend().all(CACHE);
  return rows
    .map((row) => fromRemote(row as Record<string, unknown>, args.userId))
    .filter((record) => args.includePending || record.status === 'approved' || record.status === 'validated_local')
    .filter((record) => record.status !== 'blocked' && record.status !== 'deprecated')
    .filter((record) => !record.workspaceId || !args.workspaceId || record.workspaceId === args.workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function queryBuilder<T>(value: unknown): T {
  return value as T;
}

export async function listSharedSkills(args: { userId?: string; workspaceId?: string; includePending?: boolean } = {}): Promise<SharedSkillRecord[]> {
  const client = await supabaseClient();
  if (!client) return listCached(args);
  try {
    let q = queryBuilder<{
      in(column: string, values: unknown[]): unknown;
      eq(column: string, value: unknown): unknown;
      or(filter: string): unknown;
      order(column: string, opts?: unknown): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    }>(client.from('larund_skills').select('*'));
    if (!args.includePending) q = queryBuilder(q.in('status', ['approved', 'validated_local']));
    if (args.workspaceId) q = queryBuilder(q.or(`workspace_id.is.null,workspace_id.eq.${args.workspaceId}`));
    const { data, error } = await q.order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const records = (data ?? []).map((row) => fromRemote(row as Record<string, unknown>, args.userId))
      .filter((record) => args.includePending || record.status === 'approved' || record.status === 'validated_local')
      .filter((record) => record.status !== 'blocked' && record.status !== 'deprecated');
    await Promise.all(records.filter((record) => record.status === 'approved' || record.status === 'validated_local').map(cacheRecord));
    return records;
  } catch {
    return listCached(args);
  }
}

export async function saveSkillForReview(input: SaveSkillForReviewInput): Promise<SharedSkillRecord> {
  const status = input.status ?? 'pending_review';
  const client = await supabaseClient();
  if (client) {
    try {
      const row = toRemote(input, status);
      const q = queryBuilder<Promise<{ data: unknown[] | null; error: { message: string } | null }>>(
        queryBuilder<{ select(columns?: string): unknown }>(client.from('larund_skills').insert(row)).select('*'),
      );
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const record = fromRemote((data?.[0] ?? row) as Record<string, unknown>, input.userId);
      await cacheRecord(record);
      return record;
    } catch {
      // Fall through to local cache so admin work is not lost offline.
    }
  }
  const id = `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = fromRemote({ id, ...toRemote(input, status, id), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, input.userId);
  await cacheRecord(record);
  return record;
}

export async function approveSharedSkill(skillId: string, opts: { makeGlobal: boolean }): Promise<SharedSkillRecord | null> {
  const client = await supabaseClient();
  if (client) {
    const { data, error } = await client.rpc('approve_larund_skill', { skill_id: skillId, make_global: opts.makeGlobal });
    if (!error && data) {
      const record = fromRemote(data as Record<string, unknown>);
      await cacheRecord(record);
      return record;
    }
  }
  const existing = (await listCached({ includePending: true })).find((record) => record.id === skillId);
  if (!existing) return null;
  const approved: SharedSkillRecord = {
    ...existing,
    status: 'approved',
    workspaceId: opts.makeGlobal ? undefined : existing.workspaceId,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manifestJson: {
      ...existing.manifestJson,
      status: 'approved',
      workspaceId: opts.makeGlobal ? undefined : existing.workspaceId,
      approvedAt: new Date().toISOString(),
      enabled: true,
    },
  };
  await cacheRecord(approved);
  return approved;
}

export async function blockSharedSkill(skillId: string, reason?: string): Promise<SharedSkillRecord | null> {
  const client = await supabaseClient();
  if (client) {
    const { data, error } = await client.rpc('block_larund_skill', { skill_id: skillId, reason: reason ?? null });
    if (!error && data) return fromRemote(data as Record<string, unknown>);
  }
  const existing = (await listCached({ includePending: true })).find((record) => record.id === skillId);
  if (!existing) return null;
  const blocked = { ...existing, status: 'blocked' as const, updatedAt: new Date().toISOString(), manifestJson: { ...existing.manifestJson, status: 'blocked' as const, enabled: false } };
  await cacheRecord(blocked);
  return blocked;
}

export async function recordSkillValidationRun(input: {
  skillId: string;
  taskRunId: string;
  outcome: 'success' | 'failed' | 'blocked';
  userConfirmed: boolean;
  userId?: string;
}): Promise<SharedSkillRecord | null> {
  const client = await supabaseClient();
  if (client) {
    try {
      await queryBuilder<Promise<{ data: unknown[] | null; error: { message: string } | null }>>(
        queryBuilder<{ select(columns?: string): unknown }>(client.from('larund_skill_validation_runs').upsert({
          skill_id: input.skillId,
          task_run_id: input.taskRunId,
          outcome: input.outcome,
          user_confirmed: input.userConfirmed,
          created_by: input.userId ?? null,
        }, { onConflict: 'skill_id,task_run_id' })).select('*'),
      );
    } catch {
      // Local validation fallback below.
    }
  }

  const records = await listCached({ includePending: true });
  const record = records.find((item) => item.id === input.skillId);
  if (!record) return null;
  const key = `skill_validation:${input.skillId}:${input.taskRunId}`;
  await recordBackend().put(CACHE, {
    id: key,
    kind: 'validation',
    skillId: input.skillId,
    taskRunId: input.taskRunId,
    outcome: input.outcome,
    userConfirmed: input.userConfirmed,
    createdAt: new Date().toISOString(),
  } as unknown as RecordRow);
  const validations = (await recordBackend().all(CACHE))
    .filter((row) => row.kind === 'validation' && row.skillId === input.skillId && row.outcome === 'success' && row.userConfirmed);
  if (validations.length < 3 || record.status === 'approved') return record;
  const validated = {
    ...record,
    status: 'validated_local' as const,
    updatedAt: new Date().toISOString(),
    manifestJson: {
      ...record.manifestJson,
      status: 'validated_local' as const,
      learning: {
        originTaskRunIds: record.manifestJson.learning?.originTaskRunIds ?? [],
        autoLearned: record.manifestJson.learning?.autoLearned ?? false,
        promotedAt: record.manifestJson.learning?.promotedAt,
        lastUsedAt: record.manifestJson.learning?.lastUsedAt,
        usageCount: record.manifestJson.learning?.usageCount ?? 0,
        failureCount: record.manifestJson.learning?.failureCount ?? 0,
        successCount: validations.length,
        confidence: Math.max(record.manifestJson.learning?.confidence ?? 0, 0.85),
      },
    },
  } satisfies SharedSkillRecord;
  await cacheRecord(validated);
  return validated;
}

export async function syncApprovedSharedSkills(args: { userId?: string; workspaceId?: string } = {}): Promise<SharedSkillRecord[]> {
  return listSharedSkills({ ...args, includePending: false });
}
