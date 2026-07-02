# Connections

Connections are OpenClaw-style plugins that expose external services as tools.
The agent calls them with:

```json
{"action":"connection.call","connection":"github","tool":"read_file","args":{"owner":"o","repo":"r","path":"README.md"}}
```

## Registry

`src/lib/connections/registry.ts` holds all manifests, resolves
`connection.call`, checks configuration, resolves runtime credentials, and
injects secrets for the outbound provider call. Tool execution still flows
through this registry; the UI never fakes a successful connection.

## Credential Model

Connections keep app-level developer credentials and user-level account tokens
separate:

- App-level developer credentials, such as OAuth client IDs/secrets and default
  MCP URLs, enable users to start connection flows.
- User-level tokens, API keys, PATs, and provider credential fields are stored in
  `ConnectedAccount` plus the secure user secret store. They are never written to
  `.env`, prompt text, logs, or audit records.

See [credentials-architecture.md](./connections/credentials-architecture.md).

## Catalog And Runtime State

`src/lib/connections/catalog/` is the product-facing directory of providers.
`listCatalogProviders(ctx)` reconciles catalog metadata with live runtime state:

- `connected`
- `ready_to_connect`
- `api_key_required`
- `developer_setup_missing`
- `needs_reconnect`
- `dev_shortcut_active`
- `mcp_available`
- `coming_soon`

Provider cards must use these states honestly. App-level OAuth credentials mean
"ready to connect", not "connected".

## Connections Hub UI

The product UI is `src/components/connections/ConnectionsHub.tsx`. Both the main
Connections page and Settings -> Connections render this same hub, so provider
cards, search/filter behavior, setup modals, account management, MCP connect,
test/disconnect actions, and tool policy controls share one implementation.

The main page wraps the hub in `PageFrame` with the full header, search, filters,
and upcoming toggle. Settings renders the same hub in compact mode without a page
header.

The hub reads state from:

- `listCatalogProviders(ctx)` for provider metadata and runtime state;
- `getProviderAuthConfig(providerId)` for OAuth/API-key/MCP connection mode;
- `ConnectedAccount` helpers for per-user/per-workspace accounts;
- `beginOAuthConnect()` for OAuth;
- `connectApiKeyProvider()` for API-key/PAT credential fields;
- MCP provider helpers for remote server URL, inspect, reconnect, and disconnect;
- `createConnectionRegistry(userId, projectId).call(...)` for safe test probes.

Google Workspace is shown as one unified Google connection for Drive, Gmail,
Docs, Sheets, and Calendar. Users connect via OAuth. The old Settings-only manual
`GOOGLE_WORKSPACE_ACCESS_TOKEN` panel is no longer part of the normal product UI.

GitHub and Notion present OAuth Connect in the UI because the provider auth
schema and OAuth endpoint registry define OAuth flows for them.

## API Key And PAT Providers

API-key/PAT providers use `connectApiKeyProvider()`. Each provider's credential
fields are derived from its manifest env keys, with provider-specific labels for
multi-field integrations such as WordPress and WooCommerce. Field values live in
the secure user secret store; the account metadata stores only the field names in
`metadata.credentialFields`.

## MCP Providers

MCP-capable providers use the shared MCP provider helpers. A user can save a
remote MCP URL, connect and inspect tools, review discovered tools, reconnect,
or disconnect. Approved/enabled MCP tools are the only ones exposed to the agent.

## Tool Policy

Tool policy is stored per user/workspace/provider/tool:

```txt
conn_tool_policy:<userId>:<workspaceId|personal>:<provider>:<tool>
```

`external_send`, `destructive`, and `process_exec` default to Ask. Read/local
tools default to Allow. Runtime approval enforcement remains in the existing
control/tool policy layer.

See [ui-hub.md](./connections/ui-hub.md) for the UI contract and manual
verification checklist.
