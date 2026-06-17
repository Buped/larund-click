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

Current native probes/tools use `GOOGLE_WORKSPACE_ACCESS_TOKEN` and `GOOGLE_WORKSPACE_ACCOUNT_EMAIL`.

## X / Twitter

X supports two native modes:

- Read-only: `X_BEARER_TOKEN`
- User-context write: `X_WRITE_ACCESS_TOKEN` and `X_WRITE_ACCESS_TOKEN_SECRET` plus the scopes granted by the X developer app

Posting, replying, scheduling, and deleting are never automatic. Create/reply/schedule require approval; delete is destructive and requires strong approval policy.

Optional app/API credentials such as `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_API_KEY`, and `X_API_SECRET` are reserved for later flows that actually need them.

## Evidence

Every connection call flows through `connection.call`, audit logging, and task evidence mapping. Evidence stores provider/tool names, risk, sanitized args, result summaries, output refs, and errors. It does not store API keys, bearer tokens, OAuth secrets, authorization headers, full email bodies by default, or sensitive payloads.

## MCP-Backed Connections

MCP providers are untrusted by default. Tools remain disabled until Larund inspects metadata, runs the MCP security scanner, and the user approves individual tools. Metadata changes reset approvals.
