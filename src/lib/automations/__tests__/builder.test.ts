import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createAutomation, getAutomation, updateAutomation, listAutomationRuns } from '../store';
import { runAutomation } from '../runner';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, defaultSafetyPolicy } from '../migrate';
import { heuristicSteps, missingConnectionDeps } from '../planner';
import { checkAutomationDependencies } from '../dependencies';
import { resourceToReference, type ReferencedContext } from '../../mentions/types';
import { createConnectedAccount, __resetConnectedAccountsForTests } from '../../connections/connectedAccounts';
import type { Automation } from '../types';
import { renderAutomationPrompt } from '../runner';
import { stopAllAutomationTimers } from '../scheduler';
import { completeAutomationSetup, prepareAutomation } from '../setup';
import type { EvidenceEntry } from '../../tasks/types';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => {
  stopAllAutomationTimers();
  resetRecordBackendForTests();
  __resetConnectedAccountsForTests();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'dir_list') return [];
    if (cmd === 'fs_metadata') return JSON.stringify({ is_file: true, is_dir: false, size: 1, modified_unix: 1 });
    return undefined;
  });
});

afterEach(() => stopAllAutomationTimers());

const connRef = (id: string, label: string): ReferencedContext => resourceToReference({ kind: 'connection', refId: id, label, available: false });
const refOf = (kind: ReferencedContext['kind'], id: string, label: string): ReferencedContext => resourceToReference({ kind, refId: id, label, available: true });
const fileRef = (path: string, label = path.split(/[\\/]/).pop() ?? path): ReferencedContext => ({
  id: `ref-${label}`,
  kind: 'file',
  label,
  refId: path,
  displayText: `@${label}`,
  metadata: { documentReference: { id: `doc-${label}`, kind: 'file', label, path, source: 'user_reference' } },
  insertedAt: new Date().toISOString(),
  status: 'available',
  resolvedAtSendTime: true,
});

describe('automation migration', () => {
  it('normalizes a legacy automation (no new fields)', () => {
    const legacy = {
      id: 'a1', userId: 'u1', name: 'Old', enabled: true, status: 'active',
      trigger: { kind: 'manual' }, taskTemplate: { prompt: 'do the thing' },
      autonomyMode: 'semi', approvalPolicy: {}, createdAt: '', updatedAt: '',
    } as unknown as Automation;
    const n = normalizeAutomation(legacy);
    expect(n.prompt).toBe('do the thing');
    expect(n.steps).toEqual([]);
    expect(n.referencedContext).toEqual([]);
    expect(n.verificationChecklist.length).toBeGreaterThan(0);
    expect(n.safetyPolicy.autonomyMode).toBeTruthy();
  });

  it('maps autonomy + approval into a safety policy', () => {
    expect(defaultSafetyPolicy('manual').autonomyMode).toBe('manual');
    expect(defaultSafetyPolicy('semi').externalSend).toBe('ask');
  });
});

describe('automation store with workflow fields', () => {
  it('persists referencedContext, steps, verification and safety', async () => {
    const refs = [connRef('github', 'GitHub')];
    const created = await createAutomation({
      userId: 'u1', name: 'WF', description: 'Workflow description', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' },
      prompt: 'Use @GitHub', referencedContext: refs,
      steps: [{ id: 's1', title: 'Read', instruction: 'read', referencedContext: refs, required: true, order: 0 }],
      verificationChecklist: [{ id: 'v1', title: 'read back', kind: 'file_read_back', required: true }],
      safetyPolicy: defaultSafetyPolicy('semi'),
    });
    const fetched = await getAutomation(created.id);
    const n = normalizeAutomation(fetched!);
    expect(n.description).toBe('Workflow description');
    expect(n.referencedContext).toHaveLength(1);
    expect(n.steps).toHaveLength(1);
    expect(referencedConnectionIds(n)).toContain('github');
  });

  it('persists folder-watch trigger settings', async () => {
    const created = await createAutomation({
      userId: 'u1',
      name: 'Folder monitor',
      trigger: { kind: 'folder_watch', path: 'D:/Invoices', pattern: '*.pdf', event: 'file_created_or_modified', debounceMs: 500, stableForMs: 1200, includeSubfolders: true },
      taskTemplate: { prompt: 'ingest invoices' },
    });
    const fetched = await getAutomation(created.id);
    expect(fetched?.trigger).toMatchObject({ kind: 'folder_watch', event: 'file_created_or_modified', debounceMs: 500, stableForMs: 1200, includeSubfolders: true });
  });

  it('combines template + mention references', () => {
    const n = normalizeAutomation({
      id: 'a', userId: 'u1', name: 'x', enabled: true, status: 'active',
      trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p', requiredConnectionIds: ['notion'], skillIds: ['sk1'] },
      autonomyMode: 'semi', approvalPolicy: {}, createdAt: '', updatedAt: '',
      referencedContext: [connRef('github', 'GitHub')],
    } as unknown as Automation);
    expect(referencedConnectionIds(n).sort()).toEqual(['github', 'notion']);
    expect(referencedSkillIds(n)).toContain('sk1');
  });
});

describe('automation planner (no tool execution)', () => {
  it('produces ordered steps with a verification step', () => {
    const steps = heuristicSteps({ prompt: 'Summarize my data', referencedContext: [connRef('github', 'GitHub')] });
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.map((s) => s.order)).toEqual([...steps.keys()]);
    expect(steps.some((s) => /verify|read back/i.test(s.title))).toBe(true);
  });

  it('inserts an approval step when the goal sends/publishes', () => {
    const steps = heuristicSteps({ prompt: 'Send the report by email every day', referencedContext: [] });
    expect(steps.some((s) => /approval/i.test(s.title))).toBe(true);
  });

  it('plans Google Sheet infrastructure when no sheet target is provided', () => {
    const steps = heuristicSteps({ prompt: 'Create a weekly report in Google Sheets', referencedContext: [connRef('google-workspace', 'Google')] });
    const stepText = steps.map((s) => `${s.title} ${s.instruction}`).join('\n');
    expect(stepText).toMatch(/google\.sheets\.create/i);
    expect(stepText).toMatch(/google\.sheets\.write_values/i);
    expect(stepText).toMatch(/google\.sheets\.read_values/i);
  });

  it('validates an existing Google Sheet target before use', () => {
    const steps = heuristicSteps({ prompt: 'Update https://docs.google.com/spreadsheets/d/sheet-123/edit every week', referencedContext: [connRef('google-workspace', 'Google')] });
    const stepText = steps.map((s) => `${s.title} ${s.instruction}`).join('\n');
    expect(stepText).toMatch(/google\.sheets\.(get_metadata|read_values)/i);
    expect(stepText).not.toMatch(/google\.sheets\.create/i);
  });

  it('flags missing connection dependencies', () => {
    const missing = missingConnectionDeps([connRef('google-ads', 'Google Ads')], () => false);
    expect(missing).toContain('Google Ads');
  });
});

describe('automation dependency checks', () => {
  it('blocks when a referenced connection is not connected', async () => {
    const a = await createAutomation({
      userId: 'u1', name: 'Needs GH', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' },
      prompt: 'Use @GitHub', referencedContext: [connRef('github', 'GitHub')],
    });
    const report = await checkAutomationDependencies(a, { userId: 'u1' });
    expect(report.ok).toBe(false);
    expect(report.blockers.some((b) => b.kind === 'connection' && b.refId === 'github')).toBe(true);
  });

  it('recognizes connected Google Workspace for Google service aliases', async () => {
    await createConnectedAccount({
      ctx: { userId: 'u1', workspaceId: 'ws1' },
      providerId: 'google-workspace',
      accountLabel: 'Google',
      authType: 'oauth2',
      tokens: { access_token: 'google-token' },
    });
    const a = await createAutomation({
      userId: 'u1',
      workspaceId: 'ws1',
      name: 'Google sheet report',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'read sheets', requiredConnectionIds: ['google-sheets'] },
      referencedContext: [connRef('gmail', 'Google')],
    });

    const report = await checkAutomationDependencies(a, { userId: 'u1', workspaceId: 'ws1' });

    expect(report.blockers.some((b) => b.kind === 'connection' && b.refId === 'google-workspace')).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('passes when there are no external dependencies', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'Local', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'write a file' }, prompt: 'write a file' });
    const report = await checkAutomationDependencies(a, { userId: 'u1' });
    expect(report.ok).toBe(true);
  });

  it('blocks when a referenced local file is inaccessible', async () => {
    invokeMock.mockRejectedValue(new Error('metadata failed: not found'));
    const a = await createAutomation({
      userId: 'u1',
      name: 'Needs file',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'read local file' },
      referencedContext: [fileRef('C:/missing/invoice.pdf', 'invoice.pdf')],
    });
    const report = await checkAutomationDependencies(a, { userId: 'u1' });
    expect(report.ok).toBe(false);
    expect(report.blockers.some((b) => b.kind === 'file' && /not accessible/.test(b.message))).toBe(true);
  });

  it('blocks missing memory and workflow references', async () => {
    const a = await createAutomation({
      userId: 'u1',
      name: 'Needs context',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'use context' },
      referencedContext: [refOf('memory', 'mem-missing', 'Policy memory'), refOf('workflow', 'wf-missing', 'Invoice workflow')],
    });
    const report = await checkAutomationDependencies(a, { userId: 'u1' });
    expect(report.blockers.some((b) => b.kind === 'memory')).toBe(true);
    expect(report.blockers.some((b) => b.kind === 'workflow')).toBe(true);
  });
});

describe('automation run', () => {
  it('blocks recurring runs until required setup is ready', async () => {
    const a = await createAutomation({
      userId: 'u1',
      name: 'Needs setup',
      enabled: false,
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'append rows to the provisioned sheet' },
      prompt: 'append rows to the provisioned sheet',
      setupPlan: {
        status: 'pending',
        steps: [{ id: 'setup-1', title: 'Create sheet', instruction: 'Create the Google Sheet once.', referencedContext: [], required: true, order: 0 }],
        verificationChecklist: [{ id: 'setup-v1', title: 'Sheet was read back', kind: 'sheet_values_match', required: true }],
        bindingSpecs: [{ key: 'target_sheet', label: 'Target sheet', kind: 'google_sheet', required: true }],
        bindings: [],
      },
    });

    await expect(runAutomation(a.id, { reason: 'test_run' })).rejects.toThrow(/setup is not ready/i);
  });

  it('prepareAutomation starts a setup run for pending setup', async () => {
    const a = await createAutomation({
      userId: 'u1',
      name: 'Setup runner',
      enabled: false,
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'use setup output' },
      setupPlan: {
        status: 'pending',
        steps: [{ id: 'setup-1', title: 'Create folder', instruction: 'Create the folder once.', referencedContext: [], required: true, order: 0 }],
        verificationChecklist: [],
        bindingSpecs: [],
        bindings: [],
      },
    });

    const result = await prepareAutomation(a.id, { reason: 'test' });
    const updated = await getAutomation(a.id);

    expect(result.automationRunId).toBeTruthy();
    expect(updated?.setupPlan?.status).toBe('running');
    expect(updated?.setupPlan?.lastRunId).toBe(result.automationRunId);
  });

  it('completed setup stores provisioned bindings from evidence', async () => {
    const a = await createAutomation({
      userId: 'u1',
      name: 'Bind sheet',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'append to target_sheet' },
      setupPlan: {
        status: 'running',
        steps: [],
        verificationChecklist: [],
        bindingSpecs: [{ key: 'target_sheet', label: 'Target sheet', kind: 'google_sheet', required: true }],
        bindings: [],
      },
    });
    const evidence: EvidenceEntry[] = [{
      id: 'ev-1',
      taskRunId: 'task-1',
      userId: 'u1',
      kind: 'connection_output',
      title: 'Sheet created',
      content: 'Google Sheet created: https://docs.google.com/spreadsheets/d/sheet-123/edit',
      tool: 'connection.call',
      success: true,
      createdAt: new Date().toISOString(),
    }];

    await completeAutomationSetup(a.id, evidence, 'task-1');
    const updated = normalizeAutomation((await getAutomation(a.id))!);

    expect(updated.setupPlan.status).toBe('ready');
    expect(updated.setupPlan.bindings[0]).toMatchObject({ key: 'target_sheet', kind: 'google_sheet' });
    expect(updated.setupPlan.bindings[0].url).toContain('docs.google.com/spreadsheets');
  });

  it('run now creates an AutomationRun (and a queued TaskRun via the queue)', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'R', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'create a local report and read it back' }, prompt: 'create a local report and read it back' });
    const res = await runAutomation(a.id);
    expect(res.automationRunId).toBeTruthy();
    const runs = await listAutomationRuns(a.id);
    expect(runs.length).toBeGreaterThan(0);
  });
});

describe('automation prompt rendering', () => {
  it('includes global references, step references and folder trigger input', () => {
    const globalRef = fileRef('D:/Invoices/source.pdf', 'source.pdf');
    const stepRef = fileRef('D:/Invoices/rules.xlsx', 'rules.xlsx');
    const prompt = renderAutomationPrompt({
      id: 'a',
      userId: 'u1',
      name: 'Invoice flow',
      enabled: true,
      trigger: { kind: 'folder_watch', path: 'D:/Invoices', pattern: '*.pdf' },
      taskTemplate: { prompt: 'Process invoices' },
      autonomyMode: 'semi',
      approvalPolicy: {},
      status: 'active',
      prompt: 'Process invoices',
      referencedContext: [globalRef],
      steps: [{ id: 's1', title: 'Read rules', instruction: 'Use the workbook rules.', referencedContext: [stepRef], required: true, order: 0 }],
      verificationChecklist: [],
      safetyPolicy: defaultSafetyPolicy('semi'),
      createdAt: '',
      updatedAt: '',
    }, { kind: 'folder_watch', watchedPath: 'D:/Invoices', filePath: 'D:/Invoices/new.pdf', fileName: 'new.pdf', eventType: 'file_created', detectedAt: '2026-06-20T12:00:00.000Z' });

    expect(prompt).toContain('Global referenced context:');
    expect(prompt).toContain('D:/Invoices/source.pdf');
    expect(prompt).toContain('Current trigger input:');
    expect(prompt).toContain('D:/Invoices/new.pdf');
    expect(prompt).toContain('Use the trigger file as the primary input');
    expect(prompt).toContain('Context for this step:');
    expect(prompt).toContain('D:/Invoices/rules.xlsx');
  });
});

describe('mention references', () => {
  it('creates a structured reference with displayText', () => {
    const ref = resourceToReference({ kind: 'skill', refId: 'sk1', label: 'Weekly Report', available: true });
    expect(ref.kind).toBe('skill');
    expect(ref.refId).toBe('sk1');
    expect(ref.displayText).toBe('@Weekly Report');
  });
});

describe('update keeps workflow fields', () => {
  it('updates steps and verification', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'U', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'p' }, prompt: 'p' });
    await updateAutomation(a.id, { steps: [{ id: 's', title: 'T', instruction: 'i', referencedContext: [], required: true, order: 0 }] });
    const n = normalizeAutomation((await getAutomation(a.id))!);
    expect(n.steps).toHaveLength(1);
  });
});
