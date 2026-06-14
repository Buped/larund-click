import type { ControlToolResult } from '../control-system/types';
import type { WorkflowRunner } from '../tools/types';
import { WorkflowEngine } from './engine';

// A single shared engine for the session. Workflows persist for the app's run;
// a persistent store can be swapped into WorkflowEngine without changing this.
const sharedEngine = new WorkflowEngine();

export function getWorkflowEngine(): WorkflowEngine {
  return sharedEngine;
}

export function createWorkflowRunner(engine: WorkflowEngine = sharedEngine, sessionId = 'session'): WorkflowRunner {
  return {
    async start(workflow: string, input: Record<string, unknown> | string): Promise<ControlToolResult> {
      const wf = engine.create(workflow, sessionId, { input });
      return { success: true, output: `Workflow started: ${wf.id} (${wf.name})`, details: { workflowId: wf.id, status: wf.status } };
    },
    async status(workflowId: string): Promise<ControlToolResult> {
      const wf = engine.get(workflowId);
      if (!wf) return { success: false, output: '', error: `unknown_workflow:${workflowId}` };
      return { success: true, output: `Workflow ${wf.id}: ${wf.status} @ ${wf.currentStep}`, details: { ...wf } };
    },
    async cancel(workflowId: string): Promise<ControlToolResult> {
      try {
        const wf = engine.cancel(workflowId);
        return { success: true, output: `Workflow cancelled: ${wf.id}`, details: { status: wf.status } };
      } catch (e) {
        return { success: false, output: '', error: String(e) };
      }
    },
  };
}
