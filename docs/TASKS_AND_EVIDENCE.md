# Tasks & Evidence

Every agent run becomes a persistent **TaskRun** with a timeline of **EvidenceEntry**
records and a set of **OutputRef**s. This is the product-grade record behind the
in-memory session task state, and the basis of the Task Dashboard. Code:
`src/lib/tasks/`.

## Model

```ts
TaskRun {
  id; userId; workspaceId?; sessionId;
  title; originalPrompt;
  status: 'drafting_plan' | 'waiting_approval' | 'running' | 'blocked'
        | 'needs_login' | 'needs_input' | 'verifying' | 'completed'
        | 'failed' | 'cancelled';
  activeSkillIds[]; connectionIds[]; modelId; autonomyMode;
  startedAt; updatedAt; completedAt?; error?; summary?;
  outputRefs: OutputRef[]; evidenceIds: string[]; metadata?;
}
EvidenceEntry {
  id; taskRunId; userId; workspaceId?;
  kind: 'tool_call' | 'tool_result' | 'approval' | 'read_back' | 'verification'
      | 'file_output' | 'connection_output' | 'error' | 'manual_handoff';
  title; content; tool?; risk?; success?; artifactUri?; createdAt; metadata?;
}
OutputRef { id; kind; label; uri; metadata? }  // local_file, google_doc, github_pr, …
```

## Store API (`store.ts`)

`createTaskRun`, `getTaskRun`, `setTaskStatus`, `addEvidence`, `addOutputRef`,
`listTaskRuns`, `listEvidence`, `deleteTaskRun`.

## Loop integration

In `runControlLoop` (`src/lib/control-system/loop.ts`):

- **Run start** → `startTaskTracker` creates a TaskRun (status `running`).
- **Every `emitStep`** → `stepToEvidence` maps the AgentStep into an EvidenceEntry;
  `stepToOutputRef` derives any artifact link. Best-effort, never blocks the loop.
- **`task.complete` accepted** → status `completed` (+ summary).
- **Completion guard rejects** → a `verification` evidence with `success:false` is
  recorded; the run keeps going.
- **Manual blocker** (login/captcha/permission) → `needs_login` / `blocked`.
- **`ask_user`** → `needs_input`, back to `running` on answer.
- **Error / max iterations** → `failed` (with reason). **Abort** → `cancelled`.

The pure mapping (`evidence.ts`) is fully unit-tested without the loop or store.

## UI

Coworker → **Tasks** tab: list runs (status-colored), open a run to see its evidence
timeline, output refs, verification result and error/blocker reason. A **Resume**
button is a placeholder for a later phase.
