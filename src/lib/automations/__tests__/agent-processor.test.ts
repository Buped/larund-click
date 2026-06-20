import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { listQueueItems } from '../../queue/store';
import { listAutomationRuns, createAutomation } from '../store';
import { runAutomation } from '../runner';
import {
  answerAutomationRun,
  cancelAutomationRun,
  configureAutomationQueueProcessor,
  resolveAutomationApproval,
} from '../agent-processor';
import { riskPolicyForAutomationSafety, verifyAutomationEvidence } from '../verification';
import type { AgentLoopCallbacks, AgentAbortSignal } from '../../control-system/loop';

const { runControlLoopMock } = vi.hoisted(() => ({
  runControlLoopMock: vi.fn(),
}));

vi.mock('../../control-system/loop', () => ({
  runControlLoop: runControlLoopMock,
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));

beforeEach(() => {
  resetRecordBackendForTests();
  runControlLoopMock.mockReset();
  configureAutomationQueueProcessor();
});

describe('automation agent queue processor', () => {
  it('runs manual automation through runControlLoop and completes queue/run', async () => {
    runControlLoopMock.mockImplementation(async (_task: string, _model: string, _user: string, callbacks: AgentLoopCallbacks) => {
      callbacks.onStatus('executing');
      callbacks.onStep({ id: 's1', type: 'tool_call', tool: 'browser.open', input: '{"url":"https://example.com"}', timestamp: new Date().toISOString() });
      callbacks.onStep({ id: 's2', type: 'tool_result', tool: 'browser.open', output: 'Opened https://example.com', timestamp: new Date().toISOString() });
      callbacks.onComplete('Opened example.com');
    });
    const automation = await createAutomation({
      userId: 'u1',
      workspaceId: 'ws1',
      name: 'Open example',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Open Chrome and navigate to https://example.com' },
      verificationChecklist: [],
    });

    const result = await runAutomation(automation.id, { reason: 'test' });
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'completed');

    expect(result.queueItemId).toBeTruthy();
    expect(runControlLoopMock).toHaveBeenCalledOnce();
    expect(runControlLoopMock.mock.calls[0][1]).toBe('anthropic/claude-haiku-4-5');
    const queue = await listQueueItems({ userId: 'u1' });
    expect(queue[0]).toMatchObject({ source: 'automation', status: 'completed' });
  });

  it('marks failed when the agent loop reports an error', async () => {
    runControlLoopMock.mockImplementation(async (_task: string, _model: string, _user: string, callbacks: AgentLoopCallbacks) => {
      callbacks.onStatus('executing');
      callbacks.onError('browser failed');
    });
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Failing run',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Fail' },
      verificationChecklist: [],
    });

    await runAutomation(automation.id);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'failed');

    const run = (await listAutomationRuns(automation.id))[0];
    expect(run.error).toMatch(/browser failed/);
  });

  it('goes waiting_approval and resumes after approval', async () => {
    runControlLoopMock.mockImplementation(async (_task: string, _model: string, _user: string, callbacks: AgentLoopCallbacks) => {
      callbacks.onStatus('executing');
      const decision = await callbacks.onApproval!({ action: 'browser.click', risk: 'external_write', reason: 'Like post', argsSummary: '{"label":"Like"}' });
      if (decision !== 'deny') callbacks.onComplete('Liked after approval');
    });
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Approval run',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Like a post' },
      verificationChecklist: [],
    });

    const result = await runAutomation(automation.id);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'waiting_approval');
    expect(resolveAutomationApproval(result.automationRunId, 'allow_once')).toBe(true);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'completed');
  });

  it('cancels a running automation and queue item', async () => {
    runControlLoopMock.mockImplementation(async (_task: string, _model: string, _user: string, callbacks: AgentLoopCallbacks, signal?: AgentAbortSignal) => {
      callbacks.onStatus('executing');
      await waitFor(() => Boolean(signal?.aborted));
      callbacks.onComplete('Stopped.');
    });
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Cancel run',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Wait forever' },
      verificationChecklist: [],
    });

    const result = await runAutomation(automation.id);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'running');
    await cancelAutomationRun(result.automationRunId);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'cancelled');

    const queue = await listQueueItems({ userId: 'u1' });
    expect(queue[0].status).toBe('cancelled');
  });

  it('does not complete required manual verification without user confirmation', async () => {
    runControlLoopMock.mockImplementation(async (_task: string, _model: string, _user: string, callbacks: AgentLoopCallbacks) => {
      callbacks.onComplete('Done');
    });
    const automation = await createAutomation({
      userId: 'u1',
      name: 'Manual verify',
      trigger: { kind: 'manual' },
      taskTemplate: { prompt: 'Do something requiring review' },
      verificationChecklist: [{ id: 'manual', title: 'Human checked it', kind: 'manual_review', required: true }],
    });

    const result = await runAutomation(automation.id);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'waiting_user');
    expect(answerAutomationRun(result.automationRunId, 'confirmed')).toBe(true);
    await waitFor(async () => (await listAutomationRuns(automation.id))[0]?.status === 'completed');
  });
});

describe('automation safety and verification helpers', () => {
  it('maps automation safety to runtime risk policy', () => {
    const policy = riskPolicyForAutomationSafety({
      autonomyMode: 'semi',
      externalWrite: 'allow',
      externalSend: 'ask',
      destructive: 'block',
      processExec: 'block',
    });
    expect(policy.external_write).toBe('auto');
    expect(policy.external_send).toBe('ask');
    expect(policy.destructive).toBe('block');
    expect(policy.process_exec).toBe('block');
  });

  it('fails required contains_text verification without supporting evidence', () => {
    const result = verifyAutomationEvidence(
      [{ id: 'v1', title: 'Contains done', kind: 'contains_text', required: true, config: { text: 'done' } }],
      [],
    );
    expect(result.ok).toBe(false);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}
