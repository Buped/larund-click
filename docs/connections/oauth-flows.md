# OAuth flows

How a user connects their own account, and where tokens go. App-level credentials
vs user tokens are defined in [credentials-architecture.md](./credentials-architecture.md).

## One-click desktop connect (loopback)

The user clicks **Connect**, signs in to the provider in their system browser, and
is brought right back — connected. The round-trip uses a localhost loopback server
(`tauri-plugin-oauth`); the user enters no keys.

`src/lib/connections/oauth/connect.ts` → `beginOAuthConnect(providerId, ctx, opts)`:
1. `startLoopback()` (`oauth/loopback.ts`) starts a localhost server on a fixed
   port (from `LARUND_OAUTH_CALLBACK_BASE`, default `14200`).
2. `redirectUri = http://localhost:<port>/`; `generateState()`; `createPkcePair()`
   for PKCE providers.
3. `buildAuthorizationUrl(...)` → open it with `@tauri-apps/plugin-opener`.
4. The provider redirects the browser to the loopback; the plugin emits the
   callback URL (`oauth://url`). We validate `state`, take the `code`.
5. `exchangeAuthorizationCode()` → tokens; `completeOAuthConnect()` stores the
   per-user ConnectedAccount. The loopback server is then cancelled.

Reusable building blocks in `oauth/flow.ts`: `generateState()` / `validateState()`,
`createPkcePair()`, `redirectUriFor()`, `buildAuthorizationUrl()`,
`exchangeAuthorizationCode()`, `completeOAuthConnect()`, and the per-provider
authorize/token endpoints (`OAUTH_ENDPOINTS`).

**Single shared redirect URI:** every provider uses the same loopback origin
`LARUND_OAUTH_CALLBACK_BASE` (default `http://localhost:14200`). Register exactly
`http://localhost:14200/` (with the trailing slash) in each provider's OAuth
console. There are no per-provider `*_REDIRECT_URI` env keys. The fixed port means
one connect at a time. `npm run env:audit` checks the base is a valid loopback.

## Authorization Code + PKCE (public/native clients — e.g. X)

1. App-level: `X_CLIENT_ID` (+ `X_REDIRECT_URI`). No client secret in the frontend.
2. App generates `code_verifier` / `code_challenge` and a random `state`.
3. Open the provider authorize URL in the browser with the user's chosen scopes.
4. Provider redirects back to `LARUND_OAUTH_CALLBACK_BASE/<provider>` with `code` + `state`.
5. Validate `state`; exchange `code` + `code_verifier` for tokens.
6. Store tokens in the ConnectedAccount store (access + refresh if `offline.access`).

Preferred for desktop because no secret is embedded in the client.

## Authorization Code (confidential clients — Google, GitHub, Slack, Notion, Meta, Microsoft)

Same as above but the token exchange requires the client secret.

- `LARUND_AUTH_EXCHANGE_MODE=local_dev` — exchange uses the `.env` secret directly.
  Single-developer convenience only.
- `LARUND_AUTH_EXCHANGE_MODE=backend` — the desktop opens the browser; a Larund
  backend holds the secret, performs the exchange, and returns an encrypted token
  (or token reference) the app stores per user. **Production target** for a
  distributed desktop build.

## Refresh tokens

Providers that issue refresh tokens (Google, X with `offline.access`, Microsoft)
store both access and refresh tokens. `refreshProviderTokenIfNeeded()` refreshes
the access token shortly before expiry and updates the ConnectedAccount.

## Incremental scopes

OAuth2 providers support incremental authorization: connect with read scopes
first, request write scopes (e.g. `tweet.write`, Gmail send) later. Newly granted
scopes update the ConnectedAccount and unlock the corresponding approval-gated tools.

## Connected account storage

Each completed flow creates a `ConnectedAccount` (`userId` / `workspaceId` /
`providerId` / `accountId`) with status, scopes, and `tokenRef` pointers. Token
values are written to the secret store, never into the metadata record, logs, or
prompt. Multiple accounts per provider per user are supported.

## API-key / PAT providers

No browser flow. The user enters their own key in the connection UI; Larund creates
a `ConnectedAccount` (`authType: api_key`/`pat`) and stores the key encrypted. The
developer never places user keys in `.env`.

## Disconnect / revoke

- `disconnectConnectedAccount(id)` removes the account and deletes its token secrets.
- `revokeConnectedAccountIfProviderSupportsIt(id, revoke?)` calls the provider's
  revocation endpoint when available, then removes the account.
- Expired/revoked/insufficient-scope accounts surface as **Needs reconnect** in the
  Connections UI and produce a `missing_auth (needs_reconnect)` blocker at runtime.
