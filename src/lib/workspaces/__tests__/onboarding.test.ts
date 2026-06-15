import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { applyOnboarding, buildOnboardingPlan, type OnboardingAnswers } from '../onboarding';
import { listMemory, getRelevantMemory } from '../../memory/store';
import { listWorkspaces } from '../store';

beforeEach(() => {
  resetRecordBackendForTests();
});

const marketingAnswers: OnboardingAnswers = {
  userId: 'u1',
  workspaceName: 'Marketing Client',
  purpose: 'marketing',
  tools: ['google-workspace'],
  helpWith: ['write reports', 'create marketing content'],
  neverWithoutApproval: ['send_messages', 'publish'],
  styleNotes: 'Prefer specific, punchy copy. No generic AI filler.',
};

describe('onboarding planner (pure)', () => {
  it('maps marketing purpose to skills, role and connections', () => {
    const plan = buildOnboardingPlan(marketingAnswers);
    expect(plan.workspace.kind).toBe('project');
    expect(plan.recommendedSkills).toContain('marketing-report');
    expect(plan.recommendedConnections).toContain('google-workspace');
    expect(plan.suggestedRoleId).toBe('marketing-strategist');
    expect(plan.sampleTasks.length).toBeGreaterThan(0);
  });

  it('seeds guardrail + style memories', () => {
    const plan = buildOnboardingPlan(marketingAnswers);
    const titles = plan.starterMemories.map((m) => m.title);
    expect(titles.some((t) => /Guardrail: send messages/.test(t))).toBe(true);
    expect(titles.some((t) => /Style & preferences/.test(t))).toBe(true);
    // Guardrail memory is full-confidence.
    const guardrail = plan.starterMemories.find((m) => /Guardrail/.test(m.title));
    expect(guardrail?.confidence).toBe(1);
  });

  it('tightens autonomy when many guardrails are set', () => {
    const plan = buildOnboardingPlan({
      ...marketingAnswers,
      neverWithoutApproval: ['send_messages', 'publish', 'delete_files', 'spend_money'],
    });
    expect(plan.workspace.autonomyMode).toBe('manual');
  });
});

describe('applyOnboarding (persisted)', () => {
  it('creates workspace + scoped memories the agent can retrieve', async () => {
    const result = await applyOnboarding(marketingAnswers);
    expect(result.memoryCount).toBeGreaterThanOrEqual(3);

    const workspaces = await listWorkspaces('u1');
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].enabledSkillIds).toContain('marketing-report');

    // Memories are scoped to the new workspace and active (retrievable).
    const mem = await listMemory({ userId: 'u1', workspaceId: result.workspace.id });
    expect(mem.length).toBe(result.memoryCount);

    const relevant = await getRelevantMemory({
      task: 'write marketing copy and send the report',
      userId: 'u1',
      workspaceId: result.workspace.id,
    });
    // The guardrail about sending should surface.
    expect(relevant.some((r) => /send messages/i.test(r.entry.content))).toBe(true);
  });
});
