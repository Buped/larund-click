# MCP Security

MCP tools are not trusted by default. The scanner flags:

- destructive verbs
- external send/publish/message behavior
- shell/process execution
- filesystem and network access
- secret/credential/token access
- prompt-injection-like descriptions
- ambiguous descriptions
- permissive schemas
- tool shadowing
- metadata changes

Risk mapping:

- safe reads: `read_only` or `external_read`
- writes: `local_write` or `external_write`
- send/publish/message: `external_send`
- delete/wipe/drop/truncate: `destructive`
- env/token/password/key: `credential_access`
- shell/command/process: `process_exec`

Critical flags force review. Destructive, credential, external-send, and process tools are never auto-run by default.
