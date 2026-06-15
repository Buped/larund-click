# Tool Permissions

Larund classifies every tool call by risk:

- `read_only`
- `external_read`
- `local_write`
- `external_write`
- `external_send`
- `destructive`
- `credential_access`
- `process_exec`

Default policy:

- read-only and external-read can run
- local writes can run in semi mode
- external write asks
- external send asks
- destructive asks
- credential access asks
- process execution asks

MCP and custom API tools cannot bypass this path. Unapproved MCP tools are unavailable to the unified registry.
