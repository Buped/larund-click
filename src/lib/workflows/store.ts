import type { Workflow, WorkflowStore } from './types';

/** In-memory workflow store. A persistent variant can wrap the same interface
 * and flush to ~/.larund/workflows/*.json via the file commands. */
export class MemoryWorkflowStore implements WorkflowStore {
  private map = new Map<string, Workflow>();
  constructor(private onChange?: (wf: Workflow) => void) {}

  get(id: string): Workflow | undefined {
    return this.map.get(id);
  }
  list(): Workflow[] {
    return [...this.map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  put(wf: Workflow): void {
    this.map.set(wf.id, wf);
    this.onChange?.(wf);
  }
  remove(id: string): void {
    this.map.delete(id);
  }
}
