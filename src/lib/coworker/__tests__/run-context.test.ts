import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../persistence';
import { buildCoworkerPromptContext } from '../run-context';
import { createWorkspace } from '../../workspaces/store';
import { createMemory } from '../../memory/store';
import { createBuilderSkill } from '../../skills/builder/store';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('coworker prompt context (Phase 2 integration)', () => {
  it('includes workspace + role + memory + skill, and stays bounded', async () => {
    const ws = await createWorkspace({ userId: 'u1', name: 'Marketing Client', kind: 'client' });
    await createMemory({
      userId: 'u1', workspaceId: ws.id, type: 'preference',
      title: 'Punchy copy', content: 'Prefer specific, punchy marketing copy, not generic AI text.',
      tags: ['marketing', 'copy'], scope: 'workspace',
    });
    await createBuilderSkill({
      userId: 'u1', workspaceId: ws.id, name: 'Client Weekly Report',
      description: 'Compile a weekly client report', triggerPhrases: ['weekly report'],
      allowedTools: ['sheet.read', 'file.write'], riskLevel: 'local_write',
    });

    const ctx = await buildCoworkerPromptContext({
      userId: 'u1',
      sessionId: 's1',
      task: 'write the weekly marketing report with punchy copy',
      workspaceId: ws.id,
      roleId: 'marketing-strategist',
    });

    expect(ctx.workspace?.id).toBe(ws.id);
    expect(ctx.promptBlock).toMatch(/## Workspace context/);
    expect(ctx.promptBlock).toMatch(/## Active role: Marketing Strategist/);
    expect(ctx.promptBlock).toMatch(/## Relevant memory/);
    expect(ctx.promptBlock).toMatch(/memory:mem-/); // provenance format
    expect(ctx.promptBlock).toMatch(/## Relevant skills/);
    expect(ctx.promptBlock).toMatch(/Client Weekly Report/); // custom skill surfaced
    expect(ctx.roleId).toBe('marketing-strategist');

    // Bounded: the whole coworker block must stay compact.
    expect(ctx.promptBlock.length).toBeLessThan(6000);
  });

  it('injects workflow steps when a template is selected', async () => {
    const ws = await createWorkspace({ userId: 'u1', name: 'Dev', kind: 'project' });
    const ctx = await buildCoworkerPromptContext({
      userId: 'u1', sessionId: 's2', task: 'fix the bug',
      workspaceId: ws.id, workflowTemplateId: 'github-bugfix',
    });
    expect(ctx.promptBlock).toMatch(/## Workflow: GitHub bugfix workflow/);
    expect(ctx.workflowTemplateId).toBe('github-bugfix');
  });

  it('falls back gracefully with no workspace/role/workflow', async () => {
    const ctx = await buildCoworkerPromptContext({ userId: 'u1', sessionId: 's3', task: 'do something' });
    expect(ctx.workspace).toBeTruthy(); // default workspace auto-created
    expect(ctx.promptBlock).toMatch(/## Workspace context/);
  });
});
