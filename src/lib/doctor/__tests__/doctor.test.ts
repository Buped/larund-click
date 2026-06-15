import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { buildReport } from '../checks';
import { runDoctor } from '../run';
import type { DoctorFacts } from '../types';

beforeEach(() => {
  resetRecordBackendForTests();
});

const goodFacts: DoctorFacts = {
  toolNames: ['cli.run', 'file.read', 'file.write', 'file.list', 'document.read', 'document.summarize', 'sheet.read', 'sheet.write', 'task.complete'],
  bundledSkillCount: 13,
  skillLoadErrors: [],
  googleWorkspaceStatus: 'configured',
  browserCdpAvailable: true,
  workspaceStoreOk: true,
  memoryStoreOk: true,
  taskStoreOk: true,
};

describe('doctor pure checks', () => {
  it('passes everything for healthy facts', () => {
    const report = buildReport(goodFacts);
    expect(report.summary.fail).toBe(0);
    expect(report.summary.pass).toBeGreaterThanOrEqual(8);
  });

  it('fails when a legacy mouse tool is exposed', () => {
    const report = buildReport({ ...goodFacts, toolNames: [...goodFacts.toolNames, 'mouse.click'] });
    const legacy = report.checks.find((c) => c.id === 'no-legacy-mouse');
    expect(legacy?.status).toBe('fail');
  });

  it('fails when required core tools are missing', () => {
    const report = buildReport({ ...goodFacts, toolNames: ['file.read'] });
    expect(report.checks.find((c) => c.id === 'no-mouse-core')?.status).toBe('fail');
  });

  it('warns on missing Google auth', () => {
    const report = buildReport({ ...goodFacts, googleWorkspaceStatus: 'missing_auth' });
    expect(report.checks.find((c) => c.id === 'google-workspace')?.status).toBe('warn');
  });

  it('fails when a store is broken', () => {
    const report = buildReport({ ...goodFacts, memoryStoreOk: false });
    expect(report.checks.find((c) => c.id === 'memory-store')?.status).toBe('fail');
  });
});

describe('doctor live run', () => {
  it('runs end-to-end against real registries and in-memory stores', async () => {
    const report = await runDoctor('unknown');
    // The real tool catalog has no legacy mouse tools and the stores work.
    expect(report.checks.find((c) => c.id === 'no-legacy-mouse')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'no-mouse-core')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'workspace-store')?.status).toBe('pass');
    expect(report.checks.find((c) => c.id === 'skills')?.status).toBe('pass');
  });
});
