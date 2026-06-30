import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createBuilderSkill } from '../builder/store';
import type { SkillBuilderSkill } from '../builder/types';
import { listSkillPackages } from '../packages/store';
import { approveSharedSkill, listSharedSkills, recordSkillValidationRun, saveSkillForReview } from '../shared-store';

function skill(overrides: Partial<SkillBuilderSkill> = {}): SkillBuilderSkill {
  const now = new Date().toISOString();
  return {
    id: 'skill-shared-demo',
    userId: 'u1',
    workspaceId: 'ws1',
    name: 'Shared Demo',
    version: '1.0.0',
    description: 'A shared demo skill.',
    source: 'admin_authored',
    status: 'pending_review',
    triggerPhrases: ['shared demo'],
    categories: ['demo'],
    whenToUse: ['Use for shared demo tasks.'],
    whenNotToUse: ['Do not use outside demo tasks.'],
    requiredConnections: [],
    requiredMcpServers: [],
    allowedTools: ['file.read'],
    riskLevel: 'read_only',
    steps: [{ id: 's1', title: 'Read', instruction: 'Read the source.', preferredTools: ['file.read'], required: true }],
    verificationChecklist: [{ id: 'v1', title: 'Source was read', description: 'Read back the source.', kind: 'read_back', required: true }],
    fallbackStrategy: 'Ask the user if blocked.',
    examplePrompts: ['Use the shared demo skill'],
    exampleRuns: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('shared skill store', () => {
  it('stores approved shared skills in the local cache and merges them into packages', async () => {
    const saved = await saveSkillForReview({ skill: skill(), source: 'admin_authored', userId: 'u1', workspaceId: 'ws1', status: 'approved' });
    const shared = await listSharedSkills({ userId: 'u1', workspaceId: 'ws1' });
    expect(shared.map((item) => item.id)).toContain(saved.id);

    const packages = await listSkillPackages({ userId: 'u1', workspaceId: 'ws1' });
    expect(packages.some((pkg) => pkg.name === 'Shared Demo' && pkg.source === 'admin_authored')).toBe(true);
  });

  it('lets workspace builder skills override shared skills with the same name', async () => {
    await saveSkillForReview({ skill: skill(), source: 'admin_authored', userId: 'u1', workspaceId: 'ws1', status: 'approved' });
    await createBuilderSkill({
      userId: 'u1',
      workspaceId: 'ws1',
      name: 'Shared Demo',
      description: 'Workspace override.',
      source: 'workspace',
      allowedTools: ['file.read'],
      riskLevel: 'read_only',
    });

    const packages = await listSkillPackages({ userId: 'u1', workspaceId: 'ws1' });
    expect(packages.find((pkg) => pkg.name === 'Shared Demo')?.description).toBe('Workspace override.');
  });

  it('promotes a local shared skill after three confirmed successful validation runs', async () => {
    const saved = await saveSkillForReview({ skill: skill({ source: 'self_learned', status: 'pending_review' }), source: 'self_learned', userId: 'u1', workspaceId: 'ws1' });
    await recordSkillValidationRun({ skillId: saved.id, taskRunId: 't1', outcome: 'success', userConfirmed: true, userId: 'u1' });
    await recordSkillValidationRun({ skillId: saved.id, taskRunId: 't2', outcome: 'success', userConfirmed: true, userId: 'u1' });
    const promoted = await recordSkillValidationRun({ skillId: saved.id, taskRunId: 't3', outcome: 'success', userConfirmed: true, userId: 'u1' });
    expect(promoted?.status).toBe('validated_local');
  });

  it('migration declares shared skill review tables and admin RPCs', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260630120000_larund_shared_skills.sql'), 'utf8');
    expect(sql).toContain('create table if not exists public.larund_skills');
    expect(sql).toContain('create table if not exists public.larund_skill_versions');
    expect(sql).toContain('create table if not exists public.larund_skill_review_events');
    expect(sql).toContain('create table if not exists public.larund_skill_validation_runs');
    expect(sql).toContain('public.approve_larund_skill');
    expect(sql).toContain('private.is_admin');
  });

  it('approves a pending cached skill without making it global unless requested', async () => {
    const saved = await saveSkillForReview({ skill: skill(), source: 'admin_authored', userId: 'u1', workspaceId: 'ws1' });
    const approved = await approveSharedSkill(saved.id, { makeGlobal: false });
    expect(approved?.status).toBe('approved');
    expect(approved?.workspaceId).toBe('ws1');
  });
});
