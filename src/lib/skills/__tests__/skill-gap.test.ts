import { describe, expect, it } from 'vitest';
import type { SkillRouterResult } from '../router';
import { detectSkillGap } from '../skill-gap';

const emptyRoute: SkillRouterResult = {
  selectedSkills: [],
  selectedChain: [],
  confidence: 0,
  reason: 'No confident skill match.',
  missingRequirements: [],
  shouldAskUser: false,
};

describe('skill gap detection', () => {
  it('triggers learnable for low-confidence reusable domain workflow', () => {
    const result = detectSkillGap(emptyRoute, {
      task: 'Create a new lead in https://crm.example.com every time I send this workflow.',
      userMessage: 'Create a new lead in https://crm.example.com every time I send this workflow.',
      references: [],
      availableTools: [],
      availableConnections: [],
      enabledSkillIds: [],
    });
    expect(result.kind).toBe('learnable');
    expect(result.target?.domain).toBe('crm.example.com');
  });

  it('does not trigger learning for one-off identifiable requests', () => {
    const result = detectSkillGap(emptyRoute, {
      task: 'Just this once, summarize https://example.com/about.',
      userMessage: 'Just this once, summarize https://example.com/about.',
      references: [],
      availableTools: [],
      availableConnections: [],
      enabledSkillIds: [],
    });
    expect(result.kind).toBe('one_off');
  });
});
