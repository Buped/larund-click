# Connections UI Hub

`ConnectionsHub` is the shared connection UI used by both the main Connections
page and Settings -> Connections.

## Variants

- `variant="page"`: full product page layout with header, search, full filters,
  upcoming toggle, wide card grid, and inline provider detail.
- `variant="settings"`: compact layout for the Settings modal with no page
  header, search, compact filters, and provider detail in an overlay.

Both variants use the same provider list, runtime state, setup modal, account
list, MCP panel, and tool policy panel.

## Data Flow

The hub does not own connection state. It reads and mutates the existing systems:

- provider list: `listCatalogProviders({ userId, workspaceId })`;
- auth model: `getProviderAuthConfig(providerId)`;
- OAuth: `beginOAuthConnect(providerId, ctx, options)`;
- API key/PAT: `connectApiKeyProvider()` and `disconnectApiKeyProvider()`;
- account metadata: `ConnectedAccount` helpers;
- MCP: `mcpProviderState()`, `connectMcpProvider()`, `disconnectMcpProvider()`;
- test probes: `createConnectionRegistry(userId, projectId).call(...)`.

## Credential Safety

Developer setup and user connection are separate UI sections:

- Developer setup is visible only to verified admins with Developer Mode enabled.
- Developer credentials are app-level config and are not user tokens.
- User OAuth tokens are stored through `ConnectedAccount` token refs.
- User API-key/PAT field values are stored as user secrets; metadata stores only
  field names.
- User tokens are never displayed back in the UI.

## Provider Flows

- OAuth providers show Connect/Reconnect and open the system browser through the
  existing loopback OAuth flow.
- API-key/PAT providers show provider-specific credential fields derived from
  manifest env vars.
- MCP providers show URL, Connect & inspect, status, trust warning, and
  disconnect/reconnect actions.
- Coming-soon providers show honest status copy and do not claim native runtime
  capability.

## Manual Verification Checklist

- [ ] Connections page opens.
- [ ] Settings -> Connections opens.
- [ ] Both surfaces show the same provider catalog source.
- [ ] Google appears as one unified Google connection.
- [ ] Normal users do not see the old Google access-token panel.
- [ ] Admin + Developer Mode can see developer setup fields.
- [ ] OAuth connect refreshes card state after success.
- [ ] API-key/PAT connect stores user secrets, not `.env` values.
- [ ] Disconnect removes the account and associated secrets.
- [ ] MCP connect/inspect/disconnect state updates the card.
- [ ] Search and filters work in both variants.
- [ ] Send/publish/destructive/process tools default to Ask.
- [ ] Missing auth returns a blocker, not fake success.
