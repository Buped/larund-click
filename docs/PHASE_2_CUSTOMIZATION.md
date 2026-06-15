# Phase 2 — Customization Layer

Phase 2 turns the Phase 1 Coworker Core into a **user/workspace-specific** AI
coworker. It makes Larund more general *and* more accurate via: advanced
workspace memory, a Skill Builder, workflow templates, role templates, preference
& correction learning, a memory review queue, skill testing, and workspace
onboarding.

> Larund stays a **no-mouse operator**. Nothing here adds mouse/cursor/pixel
> control. Custom skills are statically rejected if they reference mouse/visual
> tools. All external/write/destructive actions still flow through the unchanged
> `tools/run.ts` gate (policy → approval → execute → audit).

## What's new

| Area | Where | Docs |
| --- | --- | --- |
| Advanced memory (lifecycle, suggestions, review, ops) | `src/lib/memory` | [ADVANCED_MEMORY.md](ADVANCED_MEMORY.md) |
| Skill Builder (create/edit/test/install custom skills) | `src/lib/skills/builder` | [SKILL_BUILDER.md](SKILL_BUILDER.md) |
| Workspace onboarding questionnaire | `src/lib/workspaces/onboarding.ts` | [WORKSPACE_ONBOARDING.md](WORKSPACE_ONBOARDING.md) |
| Role templates | `src/lib/roles` | [ROLE_TEMPLATES.md](ROLE_TEMPLATES.md) |
| Workflow templates | `src/lib/workflows/templates` | [WORKFLOW_TEMPLATES.md](WORKFLOW_TEMPLATES.md) |

## Agent loop integration

`buildCoworkerPromptContext` (`src/lib/coworker/run-context.ts`) now composes a
bounded prompt block from: **workspace summary → active role → relevant active
memory (provenance-tagged) → relevant skills (bundled + custom, role-biased) →
workflow steps**. `RunOptions` gained `roleId` and `workflowTemplateId`; the loop
records both on the TaskRun. The skill runner is scoped to the workspace so
enabled custom skills are runnable. The whole coworker block stays compact
(test-asserted < 6000 chars).

The UI passes selections via `localStorage`:
`active_workspace_id`, `active_role_id`, and one-shot `active_workflow_template_id`
(consumed by `chat.tsx` on the next run).

## How it stays accurate (not a vague chatbot)

- Only **active** memory reaches the prompt; suggestions wait in a review queue.
- Skills carry verification checklists; the global completion guard still gates
  `task.complete`.
- Roles bias skill selection toward the right toolset for the job.
- Workflow templates attach explicit steps + verification.

## Testing Phase 2

```bash
npm test          # vitest — all suites
npx tsc --noEmit  # typecheck
npm run build     # tsc && vite build
```

See [PHASE_1_ACCEPTANCE.md](PHASE_1_ACCEPTANCE.md) for the baseline and each
Phase 2 doc for feature-specific tests + safety limitations.
