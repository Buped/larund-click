import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { createAutomation, getAutomation, updateAutomation, listAutomationRuns } from '../store';
import { runAutomation } from '../runner';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, defaultSafetyPolicy } from '../migrate';
import { heuristicSteps, missingConnectionDeps } from '../planner';
import { checkAutomationDependencies } from '../dependencies';
import { resourceToReference, type ReferencedContext } from '../../mentions/types';
import type { Automation } from '../types';

beforeEach(() => resetRecordBackendForTests());

const connRef = (id: string, label: string): ReferencedContext => resourceToReference({ kind: 'connection', refId: id, label, available: false });

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

  it('passes when there are no external dependencies', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'Local', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'write a file' }, prompt: 'write a file' });
    const report = await checkAutomationDependencies(a, { userId: 'u1' });
    expect(report.ok).toBe(true);
  });
});

describe('automation run', () => {
  it('run now creates an AutomationRun (and a queued TaskRun via the queue)', async () => {
    const a = await createAutomation({ userId: 'u1', name: 'R', trigger: { kind: 'manual' }, taskTemplate: { prompt: 'create a local report and read it back' }, prompt: 'create a local report and read it back' });
    const res = await runAutomation(a.id);
    expect(res.automationRunId).toBeTruthy();
    const runs = await listAutomationRuns(a.id);
    expect(runs.length).toBeGreaterThan(0);
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
