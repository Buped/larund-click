import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { stopAllAutomationTimers } from '../scheduler';
import { buildAutomationFromAdminText } from '../admin-builder';
import { getAutomation } from '../store';
import { createConnectedAccount, __resetConnectedAccountsForTests } from '../../connections/connectedAccounts';

const invokeMock = vi.hoisted(() => vi.fn());
const callOpenRouterJsonMock = vi.hoisted(() => vi.fn());
const listMentionResourcesMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../../openrouter', () => ({ callOpenRouterJson: callOpenRouterJsonMock }));
vi.mock('../../mentions/resources', () => ({ listMentionResources: listMentionResourcesMock }));

beforeEach(() => {
  stopAllAutomationTimers();
  resetRecordBackendForTests();
  __resetConnectedAccountsForTests();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd === 'dir_list') return [];
    if (cmd === 'fs_metadata') {
      const path = args?.path ?? '';
      return JSON.stringify({ is_file: /\.[a-z0-9]+$/i.test(path), is_dir: !/\.[a-z0-9]+$/i.test(path), size: 1, modified_unix: 1 });
    }
    return undefined;
  });
  callOpenRouterJsonMock.mockReset();
  listMentionResourcesMock.mockReset();
  listMentionResourcesMock.mockResolvedValue([]);
});

afterEach(() => stopAllAutomationTimers());

function aiJson(value: unknown) {
  callOpenRouterJsonMock.mockResolvedValue({ content: JSON.stringify(value), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, model: 'google/gemini-3.1-flash-lite' } });
}

describe('admin automation builder', () => {
  it('rejects non-admin calls', async () => {
    await expect(buildAutomationFromAdminText({
      userId: 'u1',
      isAdmin: false,
      text: 'Create a workflow',
    })).rejects.toThrow('admin_required');
  });

  it('creates a disabled automation draft from valid admin text', async () => {
    listMentionResourcesMock.mockResolvedValue([
      { kind: 'connection', refId: 'google-sheets', label: 'Google Sheets', available: true, detail: 'Connected' },
    ]);
    aiJson({
      name: 'Daily Sales Digest',
      description: 'Compile a daily sales digest.',
      prompt: 'Read Google Sheets and write a sales digest.',
      trigger: { kind: 'schedule', cron: '0 8 * * *', timezone: 'Europe/Budapest' },
      references: [{ kind: 'connection', refId: 'google-sheets' }],
      steps: [{ title: 'Read source data', instruction: 'Read the latest rows from Google Sheets.' }],
      verificationChecklist: [{ title: 'Digest was read back', kind: 'file_read_back', required: true }],
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      projectId: 'p1',
      isAdmin: true,
      text: 'Every day at 08:00 create a daily sales digest from Google Sheets.',
    });

    expect(result.automation.enabled).toBe(false);
    expect(result.automation.status).toBe('disabled');
    expect(result.automation.workspaceId).toBe('p1');
    expect(result.automation.trigger).toMatchObject({ kind: 'schedule', cron: '0 8 * * *' });
    expect(result.automation.taskTemplate.requiredConnectionIds).toContain('google-workspace');
    expect(result.automation.verificationChecklist?.some((check) => /read back/i.test(check.title))).toBe(true);
    expect(await getAutomation(result.automation.id)).toBeTruthy();
  });

  it('falls back to manual trigger, generated name, heuristic steps, and verification', async () => {
    callOpenRouterJsonMock.mockRejectedValue(new Error('offline'));

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      isAdmin: true,
      text: 'Summarize the newest support tickets into a local report',
    });

    expect(result.automation.name).toBe('Summarize the newest support tickets into a local report');
    expect(result.automation.trigger).toEqual({ kind: 'manual' });
    expect(result.automation.steps?.length).toBeGreaterThanOrEqual(3);
    expect(result.automation.steps?.some((step) => /verify|read back/i.test(step.title))).toBe(true);
    expect(result.automation.verificationChecklist?.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => /fallback/i.test(warning))).toBe(true);
  });

  it('keeps approval and safe policy for send or publish goals', async () => {
    aiJson({
      name: 'Publish Update',
      prompt: 'Publish a weekly customer update and send it by email.',
      trigger: { kind: 'manual' },
      steps: [{ title: 'Prepare update', instruction: 'Draft the weekly customer update.' }],
      safetyPolicy: { externalWrite: 'allow', externalSend: 'ask', destructive: 'ask_strong' },
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      isAdmin: true,
      text: 'Publish a weekly customer update and send it by email.',
    });

    expect(result.automation.steps?.some((step) => /approval|approve/i.test(`${step.title} ${step.instruction}`))).toBe(true);
    expect(result.automation.safetyPolicy?.externalSend).toBe('ask');
    expect(result.automation.safetyPolicy?.destructive).toBe('ask_strong');
  });

  it('adds Google Sheet infrastructure when no concrete sheet exists', async () => {
    await createConnectedAccount({
      ctx: { userId: 'u1', workspaceId: 'p1' },
      providerId: 'google-workspace',
      accountLabel: 'Google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });
    listMentionResourcesMock.mockResolvedValue([
      { kind: 'connection', refId: 'google-workspace', label: 'Google', available: true, detail: 'Connected' },
    ]);
    aiJson({
      name: 'Weekly Sheet Report',
      prompt: 'Create a weekly report in Google Sheets.',
      trigger: { kind: 'manual' },
      steps: [{ title: 'Build report', instruction: 'Prepare the weekly report.' }],
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      projectId: 'p1',
      isAdmin: true,
      text: 'Create a weekly report in Google Sheets.',
    });

    const setupText = result.automation.setupPlan?.steps.map((step) => `${step.title} ${step.instruction}`).join('\n') ?? '';
    const runText = result.automation.steps?.map((step) => `${step.title} ${step.instruction}`).join('\n') ?? '';
    expect(result.automation.taskTemplate.requiredConnectionIds).toContain('google-workspace');
    expect(['pending', 'running']).toContain(result.automation.setupPlan?.status);
    expect(setupText).toMatch(/google\.sheets\.create/i);
    expect(setupText).toMatch(/google\.sheets\.write_values/i);
    expect(setupText).toMatch(/google\.sheets\.read_values/i);
    expect(runText).not.toMatch(/google\.sheets\.create/i);
    expect(result.automation.verificationChecklist?.some((check) => check.kind === 'sheet_values_match')).toBe(true);
    expect(result.automation.safetyPolicy?.externalWrite).toBe('allow');
    expect(result.dependencyReport.ok).toBe(true);
  });

  it('validates an existing Google Sheet instead of creating a replacement', async () => {
    await createConnectedAccount({
      ctx: { userId: 'u1', workspaceId: 'p1' },
      providerId: 'google-workspace',
      accountLabel: 'Google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });
    listMentionResourcesMock.mockResolvedValue([
      { kind: 'connection', refId: 'google-workspace', label: 'Google', available: true, detail: 'Connected' },
    ]);
    aiJson({
      name: 'Existing Sheet Flow',
      prompt: 'Update https://docs.google.com/spreadsheets/d/sheet-123/edit with the weekly numbers.',
      trigger: { kind: 'manual' },
      steps: [{ title: 'Update rows', instruction: 'Write the weekly numbers.' }],
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      projectId: 'p1',
      isAdmin: true,
      text: 'Update https://docs.google.com/spreadsheets/d/sheet-123/edit with the weekly numbers.',
    });

    const setupText = result.automation.setupPlan?.steps.map((step) => `${step.title} ${step.instruction}`).join('\n') ?? '';
    const runText = result.automation.steps?.map((step) => `${step.title} ${step.instruction}`).join('\n') ?? '';
    expect(setupText).toMatch(/google\.sheets\.(get_metadata|read_values)/i);
    expect(setupText).not.toMatch(/google\.sheets\.create/i);
    expect(runText).not.toMatch(/google\.sheets\.create/i);
  });

  it('keeps Google connection as a blocker when the account is not connected', async () => {
    listMentionResourcesMock.mockResolvedValue([
      { kind: 'connection', refId: 'google-workspace', label: 'Google', available: false, detail: 'Ready to connect' },
    ]);
    aiJson({
      name: 'Needs Google Sheet',
      prompt: 'Create a tracking table in Google Sheets.',
      trigger: { kind: 'manual' },
      steps: [{ title: 'Track', instruction: 'Prepare the tracking table.' }],
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      projectId: 'p1',
      isAdmin: true,
      text: 'Create a tracking table in Google Sheets.',
    });

    expect(result.automation.taskTemplate.requiredConnectionIds).toContain('google-workspace');
    expect(result.dependencyReport.ok).toBe(false);
    expect(result.dependencyReport.blockers.some((blocker) => blocker.kind === 'connection' && blocker.refId === 'google-workspace')).toBe(true);
  });

  it('matches resources by label/id and extracts local paths', async () => {
    listMentionResourcesMock.mockResolvedValue([
      { kind: 'skill', refId: 'skill-report', label: 'Report Writer', available: true, detail: 'Created by you' },
      { kind: 'connection', refId: 'notion', label: 'Notion', available: true, detail: 'Connected' },
    ]);
    aiJson({
      name: 'Resource Matched Flow',
      prompt: 'Use Report Writer and Notion to summarize D:/Reports/source.xlsx',
      references: [{ kind: 'skill', label: 'Report Writer' }, { kind: 'connection', refId: 'notion' }],
      steps: [{ title: 'Summarize', instruction: 'Use the referenced sources and write the output.' }],
    });

    const result = await buildAutomationFromAdminText({
      userId: 'u1',
      isAdmin: true,
      text: 'Use Report Writer and Notion to summarize D:/Reports/source.xlsx',
    });

    expect(result.automation.taskTemplate.skillIds).toContain('skill-report');
    expect(result.automation.taskTemplate.requiredConnectionIds).toContain('notion');
    expect(result.automation.referencedContext?.some((ref) => ref.kind === 'file' && ref.refId.includes('source.xlsx'))).toBe(true);
  });
});
