# Workflow Templates (Phase 2 MVP)

Reusable task structures: ordered steps + verification + the skills/connections a
job needs. Starting one creates a TaskRun (recording the template id) and feeds
the steps into the agent prompt. Code: `src/lib/workflows/templates/`.

> Distinct from the existing long-running `workflows/` engine: a *template* is a
> plan shape for a single agent run, not a background job. No scheduler here —
> `scheduleCapable` / `eventTriggerCapable` flags are recorded for Phase 3.

## Model

`WorkflowTemplate`: id, name, description, workspaceId?, source
(`builtin | workspace | user`), triggerPhrases, requiredSkills,
requiredConnections, `steps: WorkflowTemplateStep[]`, `verification: string[]`,
scheduleCapable, eventTriggerCapable.

## Built-in templates

Weekly marketing report · GitHub bugfix workflow · Document to spreadsheet ·
Meeting prep · Competitor research · File organization · Google Sheet creation &
verification · Landing page audit.

## Store + start

- `listWorkflowTemplates({ userId, workspaceId })` → built-ins + the user's custom
  templates for the workspace.
- `createWorkflowTemplate(input)` / `deleteWorkflowTemplate(id)` for custom ones.
- `renderWorkflowPrompt(template)` → a compact `## Workflow: <name>` block with
  steps + a verification checklist.
- `startWorkflowFromTemplate(...)` → creates a `drafting_plan` TaskRun with
  `metadata.templateId`, returns the prompt block.

## Agent loop integration

`RunOptions.workflowTemplateId` → `buildCoworkerPromptContext` resolves the
template (built-in or the user's custom), injects its prompt block, and records the
id on the TaskRun. UI arms a one-shot `localStorage.active_workflow_template_id`
(consumed by `chat.tsx` on the next run).

UI: Coworker → **Workflows** → Start.

## Tests

`workflows/templates/__tests__/templates.test.ts`: built-ins present, list merges
custom + built-in, prompt rendering, and that starting a template creates a TaskRun
recording the template id.

## Safety / limitations

- A template only guides a single run; it does not bypass approvals or the
  completion guard (verification is attached as guidance + the global guard runs).
- No scheduling / event triggers yet (Phase 3).
