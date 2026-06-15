# Phase 4 MCP And Extensibility

Phase 4 adds the secure extensibility foundation for MCP servers, custom REST APIs, skill packages, sandbox profiles, and a unified tool catalog.

Larund remains the host. MCP servers are untrusted by default; their tools are discovered, scanned, snapshotted, risk-classified, and only bridged into the tool surface after explicit enablement and approval.

Implemented MVP:

- MCP server configs and tool snapshots
- mock MCP client adapter ready for SDK integration
- deterministic metadata scanner and hash change detection
- unified tool registry for built-ins, native connections, MCP, and custom APIs
- custom REST API tool builder
- skill package import/export with checksum validation
- sandbox profile evaluation
- local catalog UI
- audit/evidence secret redaction hardening
- team policy helper interfaces

Not public-marketplace-ready yet:

- no remote package distribution
- no real signature verification
- no OS-level sandbox
- no full MCP SDK transport lifecycle
