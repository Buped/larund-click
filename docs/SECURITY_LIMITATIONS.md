# Security Limitations

Current limitations:

- MCP uses a mock adapter, not a full SDK transport implementation.
- Sandbox profiles are enforced at Larund routing level, not OS kernel/container level.
- Custom API execution is an MVP adapter, not a full HTTP client.
- Skill package signatures are modeled but not verified.
- Team policy is an interface/helper layer; full multi-user auth is not implemented.

Still enforced:

- no mouse/cursor/pixel automation
- deny-by-default posture for risky third-party tools
- MCP metadata scanning and hash change detection
- approval gates for high-risk calls
- audit/evidence secret redaction
