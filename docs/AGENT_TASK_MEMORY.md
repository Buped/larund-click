# Persistent Task Memory, Completion Guard & Browser Workflows

No-mouse operator upgrade (2026-06-14). The agent was stateless: every message
started an isolated task, it declared `task.complete` too early, never verified
the outcome, lost the thread on corrections, and tried to satisfy cloud Google
Sheets tasks with a local file. This change makes it a **persistent, self-checking
operator** — still strictly no-mouse.

## 1. Task / context memory — `src/lib/agent-state/`

- `types.ts` — `ActiveTaskState`, `TaskContext`, `RecentAction`.
- `correction-detector.ts` — recognises HU/EN corrections ("Nem", "üres", "nem
  töltötted fel", "a megnyitott…", "ne lokális…", "folytasd").
- `task-state.ts` — create / mutate the active task and render it into the prompt.
- `goal-state.ts` — derive the concrete artifacts & checks that mean "done".
- `session-memory.ts` — per-session store. `resolveActiveTask(sessionId, msg)`
  **continues** the prior task on a correction (no reset) or classifies a fresh one.

The loop (`control-system/loop.ts`) now receives `opts.history` + `opts.sessionId`
(passed from `components/chat.tsx`), builds the active task, and injects a
`## Active Task State` block (original goal, current goal, last known state, the
latest correction, failed attempts, forbidden strategies, pending checks) plus a
`## Recent conversation` window into the system prompt every turn.

## 2. Pre-flight classification — `src/lib/control-system/preflight.ts`

Classifies the task once: `intent` (`spreadsheet_cloud | spreadsheet_local |
browser_webapp | file_ops | connection_workflow | coding | …`), target surface,
auth likelihood, whether it mutates, expected outcome, recommended/forbidden
tools. Critically separates **"Google táblázat" (cloud)** from **"Excel/CSV"
(local)**.

## 3. Completion guard — `completion-guard.ts` + `goal-verifier.ts`

Every `task.complete` is routed through `verifyBeforeComplete(state, recentActions)`
**in code** before the run closes. On reject, the loop records the failed attempt,
emits a `completion_rejected` step, feeds the reason back to the model, and keeps
going. Rules by surface:

- **spreadsheet_cloud** — a local `sheet.write` never satisfies it; needs a Google
  connection write, or a browser paste/type **plus** a non-login read-back.
- **spreadsheet_local** — needs `sheet.write` + a read-back.
- **file_ops** — needs a mutating op + a verifying read (`file.list/exists/tree`)
  *after* the last change.
- **browser_webapp** — open-only tasks need open + verified read; mutating tasks
  need a state-changing action + read-back; a login/CAPTCHA wall blocks completion.
- After a user correction, an immediate re-complete with no fresh work is rejected.

## 4. Browser workflows — `src/lib/browser-workflows/`

- `manual-blockers.ts` — login / 2FA / CAPTCHA / permission detection + HU handoff
  messages.
- `detect-page-state.ts` — parses `browser.read` output (URL/TITLE/FOCUSED/
  STATE_HINTS) into a `PageState`.
- `google-sheets.ts` — `buildTsv`, `sampleRows`, `isGoogleSheetsTask`,
  `readBackContains`.
- `browser-verifier.ts` — open-only vs. mutation verification used by the guard.

The loop watches every browser read/open result; on a manual blocker it marks the
task `blocked` and steers the model to `ask_user` (state-preserving) instead of
failing or completing.

## 5. Browser tooling

New actions: `browser.get_state`, `browser.shortcut`, `browser.paste`,
`browser.assert_text`, `browser.assert_url` (TS executor + Rust `browser_shortcut`).
Rust improvements:

- `browser_read` now reports URL, title, **focused element**, **STATE_HINTS**
  (login/captcha/permission), inputs and buttons/links.
- `browser_type` returns `AMBIGUOUS` (surfaced as an error) when several inputs
  match or none is targeted with multiple present — fixes typing into the sheet
  **title/search box** by accident.
- `browser_shortcut` dispatches trusted CDP key combos (e.g. Ctrl+V) so multi-cell
  TSV pastes into a Google Sheet grid with no mouse.

## 6. Skills (planner-visible, bundled in `skills/bundled.ts`)

- `browser-automation` (updated lifecycle + blockers + ambiguity).
- `google-sheets-web` (new) — cloud ≠ local; connection or browser TSV paste.
- `task-verification` (new) — read-back per surface before completing.

## Acceptance scenarios

1. **File ops still work** — `file.list → mkdir → move → file.list → complete`.
   ✅ guard accepts after the final `file.list` (loop test `sess-files`).
2. **YouTube open** — `browser.open → browser.read (URL/title) → complete`. ✅
   open-only verification (completion-guard test).
3. **Google Sheet, login blocker** — `browser.open sheets.new → read detects
   login_required → ask_user`, **no complete**. ✅ guard + manual-blocker tests.
4. **Google Sheet after login** — same task resumes; `clipboard.set TSV →
   browser.paste → read-back → complete`. ✅ guard accepts only with the verified
   read-back.
5. **User correction** — "Nem, a táblázat üres, nem töltötted fel" attaches to the
   prior Google Sheet task, forbids local-only `sheet.write`, continues. ✅
   session-memory + task-state tests.
6. **Local Excel** — "Készíts egy Excel fájlt 5 sor adattal" → `sheet.write` +
   read-back → complete. ✅ guard test.
7. **Cloud rejection** — opening `sheets.new` then `task.complete` is rejected
   ("still empty"). ✅ loop test `sess-sheet`.

## Verification run

`npx tsc --noEmit` ✅ · `npx vitest run` → 58 passed ✅ · `cargo check` ✅ ·
`npm run build` ✅.

## Limitations

- Cross-process durability: `session-memory` is in-process; it survives across
  turns within a running app session but is not yet persisted to the DB.
- Google Workspace connection is still a scaffold, so cloud sheets go through the
  browser TSV-paste path; grid read-back is text-heuristic (can't fully introspect
  the canvas grid over CDP).
- `browser.paste` relies on CDP-injected Ctrl+V being treated as trusted by Chrome;
  if a site blocks programmatic paste, the skill falls back to an `ask_user`
  manual-focus handoff.
