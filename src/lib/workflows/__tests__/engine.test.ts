import { describe, expect, it } from 'vitest';
import { WorkflowEngine } from '../engine';
import { RevisionConflictError } from '../types';

describe('workflow engine', () => {
  it('creates, updates, waits, resumes, finishes', () => {
    const e = new WorkflowEngine();
    const wf = e.create('inbox-triage', 'sess');
    expect(wf.status).toBe('running');
    expect(wf.revision).toBe(1);

    const updated = e.updateState(wf.id, 1, { processed: 3 }, 'classify');
    expect(updated.revision).toBe(2);
    expect(updated.currentStep).toBe('classify');

    const waiting = e.setWaiting(wf.id, 2, { until: 'client_reply' });
    expect(waiting.status).toBe('waiting');

    const resumed = e.resume(wf.id, 3);
    expect(resumed.status).toBe('running');
    expect(resumed.waitJson).toBeUndefined();

    const finished = e.finish(wf.id, 4, 'all done');
    expect(finished.status).toBe('finished');
    expect(finished.currentStep).toBe('all done');
  });

  it('detects revision conflicts', () => {
    const e = new WorkflowEngine();
    const wf = e.create('x', 'sess');
    e.updateState(wf.id, 1, {});
    expect(() => e.updateState(wf.id, 1, {})).toThrow(RevisionConflictError);
  });

  it('cancels regardless of revision', () => {
    const e = new WorkflowEngine();
    const wf = e.create('x', 'sess');
    const cancelled = e.cancel(wf.id);
    expect(cancelled.status).toBe('cancelled');
  });
});
