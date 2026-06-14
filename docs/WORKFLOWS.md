# Workflows

Workflows let multi-step tasks survive a single prompt — they have state, can
wait, resume, be cancelled, and are revision-checked (OpenClaw TaskFlow style).

## Actions

- `{"action":"workflow.start","workflow":"inbox-triage","input":{}}`
- `{"action":"workflow.status","workflow_id":"wf-…"}`
- `{"action":"workflow.cancel","workflow_id":"wf-…"}`

## Model

```ts
interface Workflow {
  id: string;
  name: string;
  ownerSessionId: string;
  status: 'running' | 'waiting' | 'blocked' | 'finished' | 'failed' | 'cancelled';
  currentStep: string;
  stateJson: unknown;
  waitJson?: unknown;
  createdAt: number; updatedAt: number; revision: number;
}
```

## Engine

`src/lib/workflows/engine.ts` exposes `create`, `updateState`, `setWaiting`,
`resume`, `finish`, `fail`, `cancel`. All mutations use **optimistic
concurrency**: passing the wrong `revision` throws `RevisionConflictError`.

The default `MemoryWorkflowStore` keeps workflows for the session; a persistent
store (e.g. `~/.larund/workflows/*.json`) can implement the same `WorkflowStore`
interface without changing the engine.

## Use cases

inbox triage · daily marketing report · waiting for a client reply · scheduled
file cleanup · GitHub PR flow · background build/test.
