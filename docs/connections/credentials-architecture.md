# Connections credential architecture

Larund is a multi-user AI coworker. Many users connect **their own** accounts.
Credentials therefore split into two strictly separated layers.

## A) App-level developer credentials

These belong to **Larund the application**. The developer configures them once.
They let any user *start* a connection flow. They are **never** user tokens.

Examples: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`GITHUB_CLIENT_ID`/`SECRET`, `SLACK_CLIENT_ID`/`SECRET`, `NOTION_CLIENT_ID`/`SECRET`,
`X_CLIENT_ID`/`SECRET`, `META_APP_ID`/`SECRET`, `*_MCP_URL`.

Location: `.env` during local development, or a secure backend in production.

## B) User-level connected-account tokens

These belong to **one Larund user**. They are created when the user clicks
**Connect** and completes OAuth or enters their own API key. They must **never**
live in `.env`.

Examples: Google access/refresh tokens, GitHub user token, Notion workspace token,
Slack bot/workspace token, X user access/refresh token, Meta page/ad-account token,
Microsoft refresh token.

Location: the **ConnectedAccount store** (`src/lib/connections/connectedAccounts.ts`),
scoped by `userId` / `workspaceId` / `providerId` / `accountId`:

- **desktop / local:** the OS secure store via the Tauri plugin-store when
  available, else encrypted local storage. Token *values* are written through the
  secret store keyed by an opaque `tokenRef`; metadata records hold only the
  pointer, never the value.
- **team / SaaS (future):** an encrypted server database with the same interface.

Token values are never exposed to the model, UI, prompt, logs, or evidence. Only
`getTokenSecretForProviderCall()` returns a raw value, for an outbound HTTP call.

## Why `.env` must not contain user tokens

`.env` is a single shared app config. A user token in `.env` would be:

- shared across every user (wrong — tokens are personal);
- limited to one account per provider (wrong — users have many);
- impossible to revoke per user;
- a security blast-radius if leaked.

So `.env` holds only the app-level OAuth client that lets each user mint **their
own** token, stored per user in the ConnectedAccount store.

## `requiredEnv` means developer config, not a user token

In `ProviderAuthConfig`, `appCredentials.requiredEnv` is app-level developer config
only. App credentials being present means **ready to connect**, never **connected**.
A user is connected only when a `ConnectedAccount` exists for them.

## Local dev vs production OAuth exchange

`LARUND_AUTH_EXCHANGE_MODE`:

- `local_dev` (default) — token exchange uses the `.env` client secrets directly.
  Fine for a single developer; **not** safe for a distributed desktop build,
  because a confidential client secret must not ship in the frontend.
- `backend` — the desktop app opens the browser for OAuth; a Larund backend holds
  the client secret and performs the code→token exchange, returning an encrypted
  token (or token reference) the app stores per user. **Production target.**

## Desktop / Tauri security model

- **One-click connect uses a localhost loopback** (`tauri-plugin-oauth`): the
  system browser opens for sign-in and redirects to `http://localhost:<port>/`,
  which the app captures in-process. Every provider shares one redirect
  (`LARUND_OAUTH_CALLBACK_BASE`, default `http://localhost:14200`); register
  `http://localhost:14200/` in each provider console. See
  [oauth-flows.md](./oauth-flows.md). Entry points: `oauth/connect.ts`,
  `oauth/loopback.ts`, `oauth/flow.ts`.
- Prefer **Authorization Code + PKCE** for providers that support public/native
  clients (e.g. X). No client secret embedded in frontend code.
- For confidential clients (Google, GitHub, Slack, Notion, Meta, Microsoft),
  proxy the token exchange through the backend in production. `.env` secrets are a
  local-dev convenience only.

## Developer-only PAT shortcuts

Some providers are easier to test with a personal token during development. These
are `DEV_*` keys, gated by `LARUND_ENABLE_DEV_PAT_SHORTCUTS=true`, surfaced only in
Developer Mode, and **ignored entirely** when the flag is false. They are never the
production path and must never be used for another user's account. See
[env.md](./env.md).

## Runtime resolution order

For a provider call by the current user (`src/lib/connections/runtimeCredentials.ts`):

1. **ConnectedAccount** for the user → use the encrypted user token.
2. **Developer Mode + `DEV_*`** → use the dev shortcut token.
3. **MCP-backed + configured** → use approved MCP tools.
4. **Otherwise** → blocker: `developer_setup_missing` (app creds absent) or
   `missing_connection` (app creds present, user not connected).

The agent never uses an app-level client secret as a user token, and never treats
a provider as connected just because client id/secret exist.
