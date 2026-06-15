# Unified Tool Registry

The unified registry represents:

- built-in no-mouse tools
- native connection tools
- MCP tools
- custom API tools
- future skill/workflow tools

`UnifiedTool` includes source, source id, risk, category, approval requirement, workspace scope, schemas, and metadata.

The registry does not expose everything blindly. It filters by:

- workspace
- enabled state
- source type
- approval state for MCP
- prompt summary limit

Built-in and native connection calls still run through existing guarded paths. MCP and custom API tools are listed only after their own enablement/approval gates.
