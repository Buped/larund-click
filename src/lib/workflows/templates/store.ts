// Workflow template store + starting a workflow. Custom templates persist through
// the shared coworker backend; built-ins come from builtin.ts. Starting a template
// creates a TaskRun (recording templateId) and renders the steps into a prompt
// block the agent loop injects.

import { recordBackend, type RecordRow } from '../../coworker/persistence';
import { createTaskRun } from '../../tasks/store';
import type { TaskRun } from '../../tasks/types';
import { BUILT_IN_WORKFLOW_TEMPLATES } from './builtin';
import type { CreateWorkflowTemplateInput, WorkflowTemplate } from './types';

const COLLECTION = 'workflow_templates';

function toTemplate(row: RecordRow): WorkflowTemplate {
  return row as unknown as WorkflowTemplate;
}

export async function createWorkflowTemplate(input: CreateWorkflowTemplateInput): Promise<WorkflowTemplate> {
  const template: WorkflowTemplate = {
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    description: input.description.trim(),
    workspaceId: input.workspaceId,
    source: input.workspaceId ? 'workspace' : 'user',
    triggerPhrases: input.triggerPhrases ?? [],
    requiredSkills: input.requiredSkills ?? [],
    requiredConnections: input.requiredConnections ?? [],
    steps: input.steps ?? [],
    verification: input.verification ?? [],
    scheduleCapable: input.scheduleCapable ?? false,
    eventTriggerCapable: input.eventTriggerCapable ?? false,
  };
  // Persist with a synthetic userId field for scoping (kept in metadata row).
  await recordBackend().put(COLLECTION, { ...(template as unknown as RecordRow), userId: input.userId });
  return template;
}

export async function deleteWorkflowTemplate(id: string): Promise<void> {
  await recordBackend().delete(COLLECTION, id);
}

/** List built-in templates plus the user's custom ones for the workspace. */
export async function listWorkflowTemplates(filter: {
  userId: string;
  workspaceId?: string;
}): Promise<WorkflowTemplate[]> {
  const rows = await recordBackend().all(COLLECTION);
  const custom = rows
    .filter((r) => (r as { userId?: string }).userId === filter.userId)
    .map(toTemplate)
    .filter((t) => !t.workspaceId || !filter.workspaceId || t.workspaceId === filter.workspaceId);
  return [...BUILT_IN_WORKFLOW_TEMPLATES, ...custom];
}

export async function getWorkflowTemplate(id: string, userId: string): Promise<WorkflowTemplate | undefined> {
  const builtin = BUILT_IN_WORKFLOW_TEMPLATES.find((t) => t.id === id);
  if (builtin) return builtin;
  const row = await recordBackend().get(COLLECTION, id);
  if (row && (row as { userId?: string }).userId === userId) return toTemplate(row);
  return undefined;
}

/** Render a workflow template into a compact prompt block. */
export function renderWorkflowPrompt(template: WorkflowTemplate): string {
  const steps = template.steps
    .map((s, i) => `${i + 1}. ${s.title}: ${s.instruction}${s.preferredTools?.length ? ` (tools: ${s.preferredTools.join(', ')})` : ''}`)
    .join('\n');
  const verify = template.verification.map((v) => `- ${v}`).join('\n');
  return [
    `## Workflow: ${template.name}`,
    template.description,
    template.requiredSkills.length ? `Use skills: ${template.requiredSkills.join(', ')}.` : '',
    '### Steps',
    steps || '(no predefined steps — plan and execute with allowed tools)',
    '### Verification (must pass before task.complete)',
    verify || '- Read the result back with an appropriate tool.',
  ].filter(Boolean).join('\n');
}

export interface StartWorkflowResult {
  taskRun: TaskRun;
  promptBlock: string;
}

/** Start a workflow from a template: creates a TaskRun and renders the prompt. */
export async function startWorkflowFromTemplate(args: {
  template: WorkflowTemplate;
  userId: string;
  workspaceId?: string;
  sessionId: string;
  prompt: string;
  modelId?: string;
  autonomyMode?: TaskRun['autonomyMode'];
}): Promise<StartWorkflowResult> {
  const taskRun = await createTaskRun({
    userId: args.userId,
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
    title: `${args.template.name}: ${args.prompt.slice(0, 60)}`,
    originalPrompt: args.prompt,
    modelId: args.modelId ?? 'core',
    autonomyMode: args.autonomyMode ?? 'semi',
    activeSkillIds: args.template.requiredSkills,
    connectionIds: args.template.requiredConnections,
    status: 'drafting_plan',
  });
  // Record the template id for traceability.
  taskRun.metadata = { ...(taskRun.metadata ?? {}), templateId: args.template.id };
  await recordBackend().put('task_runs', taskRun as unknown as RecordRow);
  return { taskRun, promptBlock: renderWorkflowPrompt(args.template) };
}
