export type WorkflowStatus =
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'finished'
  | 'failed'
  | 'cancelled';

export interface Workflow {
  id: string;
  name: string;
  ownerSessionId: string;
  status: WorkflowStatus;
  currentStep: string;
  stateJson: unknown;
  waitJson?: unknown;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface WorkflowStore {
  get(id: string): Workflow | undefined;
  list(): Workflow[];
  put(wf: Workflow): void;
  remove(id: string): void;
}

export class RevisionConflictError extends Error {
  constructor(public id: string, public expected: number, public actual: number) {
    super(`revision_conflict:${id} expected ${expected} got ${actual}`);
    this.name = 'RevisionConflictError';
  }
}
