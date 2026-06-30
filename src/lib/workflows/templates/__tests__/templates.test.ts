import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../../coworker/persistence';
import { BUILT_IN_WORKFLOW_TEMPLATES, getBuiltInTemplate } from '../builtin';
import {
  createWorkflowTemplate,
  listWorkflowTemplates,
  renderWorkflowPrompt,
  startWorkflowFromTemplate,
} from '../store';
import { getTaskRun } from '../../../tasks/store';

beforeEach(() => {
  resetRecordBackendForTests();
});

describe('workflow templates', () => {
  it('ships built-in templates', () => {
    expect(BUILT_IN_WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(17);
    expect(getBuiltInTemplate('github-bugfix')?.requiredConnections).toContain('github');
    for (const id of [
      'office-email-triage-reply',
      'office-document-prep',
      'office-system-to-system-copy',
      'office-client-materials-pack',
      'office-recurring-admin-run',
      'office-spreadsheet-refresh',
      'office-meeting-to-actions',
      'office-workspace-maintenance',
      'office-microtask-capture',
    ]) {
      expect(getBuiltInTemplate(id), id).toBeTruthy();
      expect(getBuiltInTemplate(id)?.verification.length).toBeGreaterThan(0);
    }
  });

  it('lists built-in + custom templates for a workspace', async () => {
    await createWorkflowTemplate({ userId: 'u1', workspaceId: 'ws1', name: 'My flow', description: 'custom' });
    const list = await listWorkflowTemplates({ userId: 'u1', workspaceId: 'ws1' });
    expect(list.some((t) => t.name === 'My flow')).toBe(true);
    expect(list.length).toBe(BUILT_IN_WORKFLOW_TEMPLATES.length + 1);
  });

  it('renders steps + verification into a prompt block', () => {
    const block = renderWorkflowPrompt(getBuiltInTemplate('weekly-marketing-report')!);
    expect(block).toMatch(/Workflow: Weekly marketing report/);
    expect(block).toMatch(/Verification/);
    expect(block).toMatch(/Aggregate metrics/);
  });

  it('starting a workflow creates a TaskRun recording the template id', async () => {
    const template = getBuiltInTemplate('file-organization')!;
    const { taskRun, promptBlock } = await startWorkflowFromTemplate({
      template,
      userId: 'u1',
      workspaceId: 'ws1',
      sessionId: 's1',
      prompt: 'organize my downloads',
    });
    expect(taskRun.status).toBe('drafting_plan');
    expect(taskRun.activeSkillIds).toContain('file-organizer');
    expect(promptBlock).toMatch(/File organization/);

    const reloaded = await getTaskRun(taskRun.id);
    expect((reloaded?.metadata as { templateId?: string }).templateId).toBe('file-organization');
  });
});
