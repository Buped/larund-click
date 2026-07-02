# Larund Connections Setup

Larund Connections are user-facing integrations backed by native APIs, OAuth/API keys, or approved MCP servers. Normal users should use Connections first; MCP remains an advanced implementation layer.

## Security Rules

- Do not put real secrets in source control.
- Use `.env.example` as the key list only; copy values into local `.env` or enter them in the Connections UI.
- Runtime user-entered credentials are saved through the local secret store when available, with a localStorage fallback for browser-only development.
- Tokens are never shown to the model prompt, never written to evidence, and are masked in UI.
- A connection is usable only after a provider-specific `test_connection` probe succeeds.
- Missing, placeholder, invalid, expired, or insufficiently scoped credentials return explicit auth errors. Production calls do not mock success.

## Local Developer Env

Set the keys you need in `.env`. Vite client builds can also read `VITE_<KEY>` variants for local testing, but `.env.example` lists the canonical provider keys.

Core flags:

- `LARUND_ENV=development`
- `LARUND_ALLOW_MOCK_CONNECTIONS=false`
- `LARUND_CONNECTIONS_STRICT=true`

Mock connection responses are allowed only when `LARUND_ALLOW_MOCK_CONNECTIONS=true` and the runtime/test explicitly opts in.

## Google Workspace

Google is one primary connection: `google-workspace`.

Drive, Docs, Sheets, Gmail, and Calendar subcards route back to the Google Workspace setup. GA4, Search Console, and Google Ads can share OAuth identity but require their own property/site/customer/developer-token configuration.

Start with read/write file scopes, then request send/publish scopes only when the user asks for tools such as Gmail send or Calendar event creation.

Native probes/tools receive Google access tokens from the current user's
`ConnectedAccount` at runtime. The old `GOOGLE_WORKSPACE_ACCESS_TOKEN` and
`GOOGLE_WORKSPACE_ACCOUNT_EMAIL` keys are legacy user-token keys and should not
be used for normal setup.

## X / Twitter

X supports two native modes:

- App-only public search/read: `X_APP_BEARER`. This is Larund's developer credential and is used even when the user has not connected their own X account.
- Per-user OAuth 2.0 PKCE: `X_CLIENT_ID` and optional `X_CLIENT_SECRET` let each user connect one or more X accounts. Request `tweet.read`, `tweet.write`, `users.read`, and `offline.access`.

Posting, replying, scheduling, and deleting are never automatic. Create/reply/schedule require approval; delete is destructive and requires strong approval policy. X has no native scheduled-post endpoint; Larund stores pending scheduled posts and sends them from its own scheduler/worker at `scheduled_for`.

The legacy `X_BEARER_TOKEN`, `X_WRITE_ACCESS_TOKEN`, and `X_WRITE_ACCESS_TOKEN_SECRET` keys are development shortcuts only. Production user tokens live in the ConnectedAccount store, never in `.env`.

Like/follow/unfollow and standalone quote-action tools are intentionally unavailable in the normal Larund X integration. UI cards should expose "Open on X" only for those actions.

## Evidence

Every connection call flows through `connection.call`, audit logging, and task evidence mapping. Evidence stores provider/tool names, risk, sanitized args, result summaries, output refs, and errors. It does not store API keys, bearer tokens, OAuth secrets, authorization headers, full email bodies by default, or sensitive payloads.

## MCP-Backed Connections

MCP providers are untrusted by default. Tools remain disabled until Larund inspects metadata, runs the MCP security scanner, and the user approves individual tools. Metadata changes reset approvals.
