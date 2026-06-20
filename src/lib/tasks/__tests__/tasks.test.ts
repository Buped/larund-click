import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import {
  addEvidence,
  addOutputRef,
  createTaskRun,
  getTaskRun,
  listEvidence,
  listTaskRuns,
  setTaskStatus,
} from '../store';
import { blockedStatusFor, evidenceKindForStep, stepToEvidence, stepToOutputRef } from '../evidence';

beforeEach(() => {
  resetRecordBackendForTests();
});

function newRun() {
  return createTaskRun({
    userId: 'u1',
    workspaceId: 'ws1',
    sessionId: 's1',
    title: 'Create folder and file',
    originalPrompt: 'create a folder and a txt file then read it back',
    modelId: 'core',
    autonomyMode: 'semi',
  });
}

describe('task store', () => {
  it('creates a running task and lists it', async () => {
    const run = await newRun();
    expect(run.status).toBe('running');
    const list = await listTaskRuns({ userId: 'u1' });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(run.id);
  });

  it('appends evidence and links ids to the run', async () => {
    const run = await newRun();
    await addEvidence({
      taskRunId: run.id,
      userId: 'u1',
      kind: 'file_output',
      title: 'Output file.write',
      content: 'wrote notes.txt',
      tool: 'file.write',
      success: true,
    });
    await addEvidence({
      taskRunId: run.id,
      userId: 'u1',
      kind: 'read_back',
      title: 'Read-back file.read',
      content: 'notes content',
      tool: 'file.read',
      success: true,
    });
    const evidence = await listEvidence(run.id);
    expect(evidence).toHaveLength(2);
    const reloaded = await getTaskRun(run.id);
    expect(reloaded?.evidenceIds).toHaveLength(2);
  });

  it('records failed verification as evidence', async () => {
    const run = await newRun();
    await addEvidence({
      taskRunId: run.id,
      userId: 'u1',
      kind: 'verification',
      title: 'Verification failed',
      content: 'no read-back present',
      success: false,
    });
    const evidence = await listEvidence(run.id);
    expect(evidence[0].success).toBe(false);
  });

  it('marks completed with summary and sets completedAt', async () => {
    const run = await newRun();
    const done = await setTaskStatus(run.id, 'completed', { summary: 'created + verified' });
    expect(done?.status).toBe('completed');
    expect(done?.completedAt).toBeTruthy();
    expect(done?.summary).toBe('created + verified');
  });

  it('filters by status and workspace', async () => {
    const a = await newRun();
    await setTaskStatus(a.id, 'failed', { error: 'boom' });
    await newRun();
    expect(await listTaskRuns({ userId: 'u1', status: 'failed' })).toHaveLength(1);
    expect(await listTaskRuns({ userId: 'u1', workspaceId: 'ws1' })).toHaveLength(2);
    expect(await listTaskRuns({ userId: 'u1', workspaceId: 'other' })).toHaveLength(0);
  });

  it('dedupes output refs by uri', async () => {
    const run = await newRun();
    await addOutputRef(run.id, { kind: 'local_file', label: 'a.txt', uri: 'D:/a.txt' });
    await addOutputRef(run.id, { kind: 'local_file', label: 'a.txt', uri: 'D:/a.txt' });
    const reloaded = await getTaskRun(run.id);
    expect(reloaded?.outputRefs).toHaveLength(1);
  });
});

describe('evidence mapping', () => {
  it('classifies tool result kinds', () => {
    expect(evidenceKindForStep({ type: 'tool_result', tool: 'file.read' })).toBe('read_back');
    expect(evidenceKindForStep({ type: 'tool_result', tool: 'file.write' })).toBe('file_output');
    expect(evidenceKindForStep({ type: 'tool_result', tool: 'connection.call' })).toBe('connection_output');
    expect(evidenceKindForStep({ type: 'verification' })).toBe('verification');
    expect(evidenceKindForStep({ type: 'thinking' })).toBe('thinking');
  });

  it('builds evidence input from a step', () => {
    const ev = stepToEvidence(
      { type: 'tool_result', tool: 'file.write', output: 'wrote D:/notes.txt' },
      { taskRunId: 't1', userId: 'u1' },
    );
    expect(ev?.kind).toBe('file_output');
    expect(ev?.success).toBe(true);
    expect(ev?.artifactUri).toBe('D:/notes.txt');
  });

  it('derives output refs from artifacts', () => {
    const ref = stepToOutputRef({ type: 'tool_result', tool: 'connection.call', output: 'created https://docs.google.com/document/d/abc' });
    expect(ref?.kind).toBe('google_doc');
    const none = stepToOutputRef({ type: 'tool_result', tool: 'file.read', output: 'just text, no path' });
    expect(none).toBeNull();
  });

  it('maps blocker kinds to statuses', () => {
    expect(blockedStatusFor('login')).toBe('needs_login');
    expect(blockedStatusFor('input')).toBe('needs_input');
    expect(blockedStatusFor('captcha')).toBe('blocked');
  });
});
