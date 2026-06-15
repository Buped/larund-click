# Connections

Connections are OpenClaw-style plugins that expose external services as tools.
The agent calls them with:

```json
{"action":"connection.call","connection":"github","tool":"read_file","args":{"owner":"o","repo":"r","path":"README.md"}}
```

## Registry

`src/lib/connections/registry.ts` holds all manifests, resolves
`connection.call`, checks configuration and injects secrets. `listConnections()`
returns each provider's status for the UI.

## Manifest

```ts
interface ConnectionManifest {
  id: string;
  name: string;
  description: string;
  auth: { type: 'api_key' | 'oauth' | 'none' | 'custom'; envVars?: string[]; scopes?: string[] };
  tools: ConnectionToolDefinition[];
  skills?: string[];
  scaffold?: boolean;   // true = listed but not yet runnable
  risk?: ToolRisk;
}
```

## Providers

| Provider          | Status   | Notes |
|-------------------|----------|-------|
| GitHub            | MVP      | Real REST calls; **mock output when `GITHUB_TOKEN` is missing**. read/search/issues + write/branch/PR/comment. |
| Notion            | MVP      | Real REST calls; mock output without `NOTION_TOKEN`. search/read/query + create/update. |
| Google Workspace  | scaffold | Typed Gmail/Drive/Sheets/Calendar tools; disabled until OAuth. |
| Slack             | scaffold | search/send/reply; disabled until token. |
| HubSpot/Airtable/WordPress | scaffold | manifest + tool schema only. |

## Secrets

`src/lib/connections/secrets.ts` reads secrets from an in-memory store
(set by the settings UI) then `import.meta.env.VITE_<KEY>`. Secrets are **never**
written to prompts or the audit log (`audit.ts` redacts them).

## Status

`configured` (auth present) · `missing_auth` · `scaffold` · `disabled`.
Reads fall back to deterministic mock output when unauthenticated so flows are
testable without credentials.

## Phase 1 — Connections Hub

A product-grade view layered over the existing manifests/registry. Underlying tool
execution still flows through `connection.call` → `ConnectionRegistry`, unchanged.
Code: `src/lib/connections/hub/`.

- **`ConnectionProvider`** (`status.ts`) — what is *available*. Derived from each
  `ConnectionManifest`: inferred `category` (productivity/development/marketing/data/
  communication/custom), mapped `authType` (none/oauth/api_key/access_token/local/mcp),
  `status` (available/configured/missing_auth/error), tool list with risk.
- **`ConnectionInstance`** (`store.ts`) — what a user has *configured* per workspace:
  `createConnectionInstance`, `setConnectionEnabled`, `markConnectionUsed`,
  `listConnectionInstances`, `availableConnectionIds` (feeds skill ranking).
- **`planConnectionTest`** — a **non-destructive** connectivity probe: picks a
  read-only/metadata tool; never creates files; reports missing auth clearly.

Google Workspace keeps its current access-token/settings behavior; missing auth now
surfaces an explicit user-facing message instead of failing silently.

UI: Coworker → **Connections** tab shows provider cards (Google Workspace, GitHub,
Notion, Slack, + scaffolds) with category, status, auth type, tool count and missing-
auth guidance.
