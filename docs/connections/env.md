# `.env` reference

`.env` holds **app-level developer credentials only**. User tokens live in the
ConnectedAccount store — see [credentials-architecture.md](./credentials-architecture.md).

Generate or reconcile it:

```bash
npm run env:sync                 # app-level credentials only
npm run env:sync:dev-shortcuts   # also add the DEV_* shortcut block
npm run env:audit                # report readiness + legacy keys to migrate
```

`env:sync` preserves existing values, removes duplicate keys, and never writes user
tokens. `--prune` drops keys it doesn't manage.

## Minimal app-level keys

### Larund core
```
LARUND_ENV=development
LARUND_APP_URL=http://localhost:1420
LARUND_API_URL=http://localhost:1420
LARUND_CONNECTIONS_STRICT=true
LARUND_ALLOW_MOCK_CONNECTIONS=false
LARUND_ENABLE_DEV_PAT_SHORTCUTS=false
LARUND_AUTH_EXCHANGE_MODE=local_dev      # local_dev | backend
# Single shared desktop loopback redirect. Register `<base>/` (http://localhost:14200/)
# in EVERY provider's OAuth console. No per-provider redirect keys.
LARUND_OAUTH_CALLBACK_BASE=http://localhost:14200
```

### Per-provider OAuth apps — only CLIENT_ID/SECRET (set once by the developer)
```
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID= / GITHUB_CLIENT_SECRET=
NOTION_CLIENT_ID= / NOTION_CLIENT_SECRET=
SLACK_CLIENT_ID= / SLACK_CLIENT_SECRET= / SLACK_SIGNING_SECRET=
X_CLIENT_ID= / X_CLIENT_SECRET=
META_APP_ID= / META_APP_SECRET=
MICROSOFT_CLIENT_ID= / MICROSOFT_CLIENT_SECRET= / MICROSOFT_TENANT_ID=
DISCORD_CLIENT_ID= / DISCORD_CLIENT_SECRET=
```
End users enter nothing — they click **Connect** and sign in. Their tokens go to the
ConnectedAccount store, never `.env`.

### MCP provider URLs (default endpoints, not user tokens)
```
HIGGSFIELD_MCP_URL= / CANVA_MCP_URL= / FIGMA_MCP_URL= / LINEAR_MCP_URL= / SUPABASE_MCP_URL= / VERCEL_MCP_URL=
```

## Optional: developer-only PAT shortcuts

Single-developer testing only. Written only with `--include-dev-shortcuts`, used
only when `LARUND_ENABLE_DEV_PAT_SHORTCUTS=true`, surfaced only in Developer Mode,
and ignored otherwise. Never multi-user; never another user's account.

```
DEV_GITHUB_TOKEN= DEV_NOTION_TOKEN= DEV_SLACK_BOT_TOKEN= DEV_DISCORD_BOT_TOKEN=
DEV_X_BEARER_TOKEN= DEV_AIRTABLE_TOKEN= DEV_LINEAR_API_KEY= DEV_HUBSPOT_PRIVATE_APP_TOKEN=
DEV_WORDPRESS_SITE_URL= DEV_WORDPRESS_USERNAME= DEV_WORDPRESS_APP_PASSWORD=
DEV_RESEND_API_KEY= DEV_SENDGRID_API_KEY= DEV_SUPABASE_URL= DEV_SUPABASE_SERVICE_ROLE_KEY=
DEV_VERCEL_TOKEN= DEV_STRIPE_SECRET_KEY=
```

## Migration from the old design

These keys were user tokens or dev shortcuts in the previous design. `env:sync`
preserves them (never auto-deletes) but flags them; `env:audit` lists them:

| Old key | Action |
| --- | --- |
| `GITHUB_TOKEN` | → `DEV_GITHUB_TOKEN` (dev) or reconnect via OAuth |
| `NOTION_TOKEN` | → `DEV_NOTION_TOKEN` (dev) or reconnect via OAuth |
| `SLACK_BOT_TOKEN` | → `DEV_SLACK_BOT_TOKEN` (dev) or reconnect via OAuth |
| `DISCORD_BOT_TOKEN` | → `DEV_DISCORD_BOT_TOKEN` (bot-only dev) |
| `X_BEARER_TOKEN` | → `DEV_X_BEARER_TOKEN` (app-only read) |
| `X_WRITE_ACCESS_TOKEN` / `_SECRET` | → `DEV_X_WRITE_ACCESS_TOKEN` / `_SECRET` (dev) or reconnect X via OAuth |
| `GOOGLE_WORKSPACE_ACCESS_TOKEN` / `REFRESH_TOKEN` / `ACCOUNT_EMAIL` | **Do not migrate.** Regenerate through OAuth into the ConnectedAccount store. |

## Provider-by-provider

- **Google** — one OAuth app (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) powers Drive,
  Docs, Sheets, Gmail, Calendar (and Ads/GA4/Search Console, which add a selected
  resource ID stored per connected account). User tokens never in `.env`.
- **GitHub / Notion / Slack / Microsoft / Meta / Discord** — app OAuth client in
  `.env`; user tokens per connected account. Optional `DEV_*` shortcut for the
  first four.
- **X** — OAuth2 + PKCE. Read and write are per-user scopes; `tweet.write` is
  approval-gated. `DEV_X_BEARER_TOKEN` is app-only read for development.
- **API-key-only providers** (Resend, SendGrid, Stripe, Vercel, Supabase,
  Airtable, Linear, HubSpot, WordPress, …) — no developer `.env` entry; the user
  enters their own key in the connection UI, stored encrypted per user.
