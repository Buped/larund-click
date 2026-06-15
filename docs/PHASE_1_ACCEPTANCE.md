# Phase 1 Acceptance

How to verify the Larund Coworker Core foundation.

## Automated

```bash
npm test          # vitest — all suites
npx tsc --noEmit  # typecheck
npm run build     # tsc && vite build
```

Phase 1 adds suites:
- `src/lib/workspaces/__tests__/workspaces.test.ts` — CRUD, default, active/resolve, summary.
- `src/lib/memory/__tests__/memory.test.ts` — scoring, workspace scoping, store, extraction.
- `src/lib/tasks/__tests__/tasks.test.ts` — TaskRun/evidence store + step→evidence mapping.
- `src/lib/skills/__tests__/manifest-ranking.test.ts` — rich manifest + workspace ranking.
- `src/lib/connections/hub/__tests__/hub.test.ts` — provider metadata + instance store.
- `src/lib/doctor/__tests__/doctor.test.ts` — pure checks + live run.

Existing guarantees still pass: the **completion guard** suite is intact, and Doctor
asserts **no legacy mouse/visual action** appears in the tool catalog.

## Manual validation

1. **Create a workspace** "Larund Dev" → Coworker → Workspaces → Create. Set it active.
2. **Add a memory**: "Always verify file outputs by reading them back." (type:
   preference) in Coworker → Memory.
3. **Run a file task** from chat: *"create a folder on my desktop and a notes.txt file
   in it, then read it back."*
4. Confirm the run appears in Coworker → **Tasks**.
5. Open it: the **evidence timeline** shows the `file_output` (write) and `read_back`
   (read) entries; an output ref points at the file.
6. Confirm completion is **rejected** if the agent tries `task.complete` with no
   read-back (a failed `verification` evidence is recorded).
7. **Google Workspace**: if unconfigured, Coworker → Connections shows
   `missing auth` with guidance.
8. **Skills**: Coworker → Skills lists all bundled skills with risk/tools/connections.
9. **Doctor**: Coworker → Audit / Doctor → Run diagnostics → all core checks pass,
   no-legacy-mouse passes.

## Known limitations (MVP)

- Retrieval is lexical (no vector search yet) — interface is ready for it.
- No full Skill Builder/editor or marketplace yet; skills remain `SKILL.md`-driven.
- Connection OAuth is not productionized; Google Workspace uses an access token / mock.
- Task **Resume** is a placeholder.
- Memory extraction surfaces candidates but the review-to-save UI is not wired yet.
- The coworker document store keeps full JSON per record (no indexed columns); fine at
  local single-user scale.
