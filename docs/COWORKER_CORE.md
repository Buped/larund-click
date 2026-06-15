# Larund Coworker Core (Phase 1)

Larund is a **general, customizable AI coworker** — not a narrow single-use tool and
**not** a vague chatbot. It is accurate because it works through structured systems:
workspaces, memory, skills, tools, connections, approvals, audit and verification.

> **Non-negotiable:** Larund is a **no-mouse operator.** There is no mouse, cursor,
> pixel, screenshot or visual-control core. The agent acts through CLI, files,
> documents, spreadsheets, the browser DOM/CDP, connections, skills and workflows.

## The systems

| System | Folder | What it does |
| --- | --- | --- |
| **Workspaces** | `src/lib/workspaces` | The customization boundary: roots, connections, skills, autonomy, model. See [WORKSPACES.md](WORKSPACES.md). |
| **Memory** | `src/lib/memory` | Structured long-term knowledge (not chat history). See [MEMORY_SYSTEM.md](MEMORY_SYSTEM.md). |
| **Tasks & Evidence** | `src/lib/tasks` | Every run is a persisted TaskRun with an evidence timeline. See [TASKS_AND_EVIDENCE.md](TASKS_AND_EVIDENCE.md). |
| **Skills** | `src/lib/skills` | Structured workflow modules with rich manifests. See [SKILLS.md](SKILLS.md). |
| **Connections** | `src/lib/connections` | External tool providers + per-workspace instances. See [CONNECTIONS.md](CONNECTIONS.md). |
| **Doctor** | `src/lib/doctor` | Diagnostics / onboarding checks. |

## Persistence

All Coworker Core data persists through one shared abstraction
(`src/lib/coworker/persistence.ts`):

- **`InMemoryBackend`** — the default; the only backend used in tests.
- **`SqlBackend`** (`src/lib/coworker/sql-backend.ts`) — a single `coworker_kv`
  table in the existing per-user Tauri SQLite database. Installed at app startup by
  `installSqlCoworkerBackend()` (called from `App.tsx` after `initDatabase`).

Documents are stored opaquely as JSON keyed by `(collection, id)`; filtering is done
in JS. Larund is local-first and single-user, so row counts are small and a uniform
document store keeps every domain trivial. A future vector/indexed backend can
replace one file without touching any store.

## How a run uses the core

`src/lib/coworker/run-context.ts` bridges the agent loop and the stores. On every run
(`runControlLoop`):

1. **Resolve workspace** — explicit `opts.workspaceId` → session active → user default.
2. **Build prompt context** — a *compact* block: workspace summary + relevant memory
   + relevant workspace-enabled skills. Hard char/count limits; never raw data.
3. **Start a TaskRun** — every step becomes an `EvidenceEntry`; artifacts become
   `OutputRef`s; status transitions to `completed` / `failed` / `needs_input` /
   `needs_login` / `blocked` / `cancelled`.
4. **Verification** — the existing completion guard still gates `task.complete`. A
   rejected completion is recorded as failed verification evidence.

Everything in the bridge is **best-effort**: if a store fails, the core no-mouse loop
still runs unchanged.

## Extending the core

- **New domain store** → reuse `recordBackend()`; add a `collection` name; keep pure
  logic in a separate module so it is unit-testable with the in-memory backend.
- **New connection** → add a `ConnectionManifest`; the hub maps it automatically.
- **New skill** → add a `SKILL.md` (frontmatter + body); the rich-manifest layer fills
  defaults. See [SKILLS.md](SKILLS.md).

See [PHASE_1_ACCEPTANCE.md](PHASE_1_ACCEPTANCE.md) for how to verify Phase 1.
