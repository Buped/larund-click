// Workflow Templates (Phase 2). A reusable task structure: ordered steps +
// verification + the skills/connections it needs. Starting a template creates a
// TaskRun (recording the template id) and feeds the steps into the agent prompt.
//
// This is distinct from the existing long-running `workflows/` engine: a template
// is a *plan shape* for a single agent run, not a background job. No scheduler
// here — scheduling/event triggers are Phase 3 (the capability flags are recorded
// now so the data model is ready).

export type WorkflowTemplateSource = 'builtin' | 'workspace' | 'user';

export interface WorkflowTemplateStep {
  id: string;
  title: string;
  instruction: string;
  preferredTools?: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  workspaceId?: string;
  source: WorkflowTemplateSource;
  triggerPhrases: string[];
  requiredSkills: string[];
  requiredConnections: string[];
  steps: WorkflowTemplateStep[];
  verification: string[];
  scheduleCapable: boolean;
  eventTriggerCapable: boolean;
}

export interface CreateWorkflowTemplateInput {
  userId: string;
  workspaceId?: string;
  name: string;
  description: string;
  triggerPhrases?: string[];
  requiredSkills?: string[];
  requiredConnections?: string[];
  steps?: WorkflowTemplateStep[];
  verification?: string[];
  scheduleCapable?: boolean;
  eventTriggerCapable?: boolean;
}
