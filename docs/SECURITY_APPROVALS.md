# Security & Approvals

## Risk model

Every action is classified by `policy.ts → assessRisk`:

| Risk | Default decision |
|------|------------------|
| `read_only`        | auto |
| `external_read`    | auto |
| `local_write`      | auto |
| `external_write`   | ask |
| `external_send`    | ask |
| `destructive`      | ask |
| `credential_access`| ask |
| `process_exec`     | ask |

`cli.run` risk is derived from the command: read-only commands (`git status`,
`ls`, …) are `read_only`; installs are `process_exec`; `rm -rf`, `del /s`,
`format`, `reg delete`, `sudo`, fork-bombs, etc. are `destructive` and always
require approval (`isDangerousCommand`).

## Always require approval

- `file.delete`, `process.kill`
- destructive shell commands, install commands
- external writes: GitHub PR/comment/write, Notion/CRM writes
- external sends: email / Slack messages
- credential access
- browser actions that submit forms or publish

## Approval flow

`tools/run.ts` calls `ApprovalService.request` for `ask` decisions. The loop
wires this to a dedicated `onApproval` callback or falls back to a yes/no
`ask_user` prompt. Decisions: `allow_once`, `allow_always` (per tool), `deny`.

## Audit log

`audit.ts` records every tool call: timestamp, session, action, **redacted**
args, risk, category, success, output summary, duration, approval id. Secrets
(tokens, passwords, api keys, long token-like literals) are stripped via
`sanitizeArgs` / `summarizeOutput` and never logged.

## Secrets

Stored in an in-memory store or `VITE_*` env vars. Never placed in prompts or
the audit log. See [CONNECTIONS.md](CONNECTIONS.md).
