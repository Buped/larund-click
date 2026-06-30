import { describe, expect, it, vi } from 'vitest';
import { synthesizeSelfLearnedSkill, type SkillResearchSummary } from '../self-learning';

const callOpenRouterJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../../openrouter', () => ({ callOpenRouterJson: callOpenRouterJsonMock }));

const research: SkillResearchSummary = {
  targetLabel: 'crm.example.com',
  query: 'crm example workflow',
  sources: [],
  appOrSiteKind: 'CRM',
  workflowSteps: ['Open lead form', 'Fill fields', 'Read back confirmation'],
  apiFirstRecommendation: 'Use API if a connection exists.',
  blockers: [],
  needsLogin: false,
};

describe('self-learning synthesis', () => {
  it('creates a pending disabled self-learned draft from successful evidence', async () => {
    callOpenRouterJsonMock.mockResolvedValueOnce({
      content: JSON.stringify({
        name: 'CRM Lead Creation',
        description: 'Create and verify CRM leads.',
        triggerPhrases: ['crm lead'],
        categories: ['crm'],
        steps: ['Open the CRM lead form.', 'Fill the required fields.', 'Read back the saved lead.'],
        verificationChecklist: ['Saved lead was read back.'],
        fallbackStrategy: 'Ask the user if login or captcha blocks the flow.',
      }),
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, model: 'google/gemini-3.1-flash-lite' },
    });

    const draft = await synthesizeSelfLearnedSkill({
      userId: 'u1',
      workspaceId: 'ws1',
      taskRunId: 'task-1',
      task: 'Create a CRM lead at crm.example.com',
      research,
      evidence: [
        { action: 'browser.open', success: true, argsSummary: 'https://crm.example.com', output: 'opened' },
        { action: 'browser.type', success: true, output: 'typed' },
        { action: 'browser.read', success: true, output: 'Lead saved' },
      ],
    });

    expect(draft?.skill.source).toBe('self_learned');
    expect(draft?.skill.status).toBe('pending_review');
    expect(draft?.skill.enabled).toBe(false);
    expect(draft?.dryRun.ok).toBe(true);
  });

  it('does not synthesize a skill from login or captcha blocker evidence', async () => {
    const draft = await synthesizeSelfLearnedSkill({
      userId: 'u1',
      workspaceId: 'ws1',
      taskRunId: 'task-1',
      task: 'Create a CRM lead at crm.example.com',
      research,
      evidence: [
        { action: 'browser.open', success: true, output: 'opened' },
        { action: 'browser.read', success: false, error: 'captcha blocked' },
      ],
    });
    expect(draft).toBeNull();
  });
});
