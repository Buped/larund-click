# Tools

Every action the agent can emit is a typed member of the `ControlAction` union
(`src/lib/control-system/types.ts`) and appears in the tool catalog
(`src/lib/tools/registry.ts`).

## Pipeline

Each tool call goes through `tools/run.ts → runControlAction`:

1. **schema** — guaranteed by the parser (closed allow-list).
2. **policy** — `policy.ts` assesses risk and decides `auto` / `ask` / `block`.
3. **approval** — risky actions go to the `ApprovalService`.
4. **execute** — `executor.ts` dispatches to a Tauri command or sub-registry.
5. **audit** — `audit.ts` records a redacted entry.
6. **normalize** — a `ControlToolResult` is returned.

## Categories

| Category     | Actions |
|--------------|---------|
| runtime      | `cli.run`, `process.start/status/kill`, `task.complete`, `ask_user` |
| files        | `file.read/write/edit/list/mkdir/copy/move/delete/search/tree/exists/metadata` |
| data         | `sheet.read`, `sheet.write` |
| clipboard    | `clipboard.get`, `clipboard.set` |
| apps         | `app.open`, `window.list`, `window.focus`, `keyboard.press`, `keyboard.combo` |
| browser      | `browser.open/read/click/type/key/wait/extract_table/download/upload` |
| connections  | `connection.call` |
| skills       | `skill.run` |
| workflows    | `workflow.start/status/cancel` |
| approvals    | `approval.request` |

## Risk levels

`read_only`, `local_write`, `external_read`, `external_write`, `external_send`,
`destructive`, `credential_access`, `process_exec`. See
[SECURITY_APPROVALS.md](SECURITY_APPROVALS.md).

## Adding a tool

1. Add the variant to `ControlAction` in `types.ts`.
2. Add it to the allow-list in `parser.ts` and `ACTION_CATEGORY` in `policy.ts`.
3. Add a risk case in `assessRisk` and an entry to `TOOL_CATALOG`.
4. Implement the dispatch in `executor.ts` (and a Rust command if needed).
5. Add a test.
