import { MemoryWorkflowStore } from './store';
import { RevisionConflictError, type Workflow, type WorkflowStatus, type WorkflowStore } from './types';

let counter = 0;
function newWorkflowId(): string {
  counter += 1;
  return `wf-${Date.now()}-${counter}`;
}

export class WorkflowEngine {
  constructor(private store: WorkflowStore = new MemoryWorkflowStore()) {}

  create(name: string, ownerSessionId: string, initialState: unknown = {}): Workflow {
    const now = Date.now();
    const wf: Workflow = {
      id: newWorkflowId(),
      name,
      ownerSessionId,
      status: 'running',
      currentStep: 'start',
      stateJson: initialState,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    this.store.put(wf);
    return wf;
  }

  get(id: string): Workflow | undefined {
    return this.store.get(id);
  }

  list(): Workflow[] {
    return this.store.list();
  }

  /** Apply an update with optimistic concurrency on `revision`. */
  private mutate(id: string, expectedRevision: number, patch: Partial<Workflow>): Workflow {
    const wf = this.store.get(id);
    if (!wf) throw new Error(`unknown_workflow:${id}`);
    if (wf.revision !== expectedRevision) throw new RevisionConflictError(id, expectedRevision, wf.revision);
    const next: Workflow = { ...wf, ...patch, revision: wf.revision + 1, updatedAt: Date.now() };
    this.store.put(next);
    return next;
  }

  updateState(id: string, expectedRevision: number, stateJson: unknown, currentStep?: string): Workflow {
    return this.mutate(id, expectedRevision, { stateJson, ...(currentStep ? { currentStep } : {}) });
  }

  setWaiting(id: string, expectedRevision: number, waitJson: unknown): Workflow {
    return this.mutate(id, expectedRevision, { status: 'waiting', waitJson });
  }

  resume(id: string, expectedRevision: number): Workflow {
    return this.mutate(id, expectedRevision, { status: 'running', waitJson: undefined });
  }

  finish(id: string, expectedRevision: number, summary = 'finished'): Workflow {
    return this.mutate(id, expectedRevision, { status: 'finished', currentStep: summary });
  }

  fail(id: string, expectedRevision: number, error: string): Workflow {
    return this.mutate(id, expectedRevision, { status: 'failed', currentStep: error });
  }

  cancel(id: string): Workflow {
    const wf = this.store.get(id);
    if (!wf) throw new Error(`unknown_workflow:${id}`);
    const next: Workflow = { ...wf, status: 'cancelled' as WorkflowStatus, revision: wf.revision + 1, updatedAt: Date.now() };
    this.store.put(next);
    return next;
  }
}
