import { isPlaceholderSecret } from '../secrets';

// ─────────────────────────────────────────────────────────────────────────────
// Credential architecture (see docs/connections/credentials-architecture.md)
//
// There are TWO kinds of credential and they must never be confused:
//
//   A) App-level developer credentials  → live in `.env` (or a backend).
//      These belong to Larund the application: OAuth client id/secret, redirect
//      URI, signing secret, MCP server URL. The developer configures them ONCE.
//      They let a user START a connection flow. They are NOT user tokens.
//
//   B) User-level connected-account tokens → live in the ConnectedAccount store
//      (encrypted, per user/workspace/account). These are created when a user
//      clicks Connect. They must NEVER live in `.env`.
//
// `appRequired` therefore means "developer setup needed to enable Connect", never
// "a user is connected". A provider with app creds present is *ready to connect*,
// not *connected*.
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderAuthMode =
  | 'oauth2_authorization_code_pkce'
  | 'oauth2_authorization_code_confidential'
  | 'oauth1a'
  | 'api_key_user_entered'
  | 'pat_user_entered'
  | 'mcp_url'
  | 'none';

export type UserCredentialStorage =
  | 'connected_account_store'
  | 'secure_user_secret'
  | 'mcp_server_config'
  | 'none';

export interface ProviderEnvSchema {
  providerId: string;
  authMode: ProviderAuthMode;
  /** App-level developer credentials required to enable Connect. NEVER user tokens. */
  appRequired: string[];
  /** App-level credentials that are optional (e.g. signing secret, confidential client secret). */
  appOptional: string[];
  /** Where the connected user's token is stored once they connect. */
  userCredentialStorage: UserCredentialStorage;
  /** DEV_* single-developer personal-token shortcuts (only with LARUND_ENABLE_DEV_PAT_SHORTCUTS=true). */
  devShortcut: string[];
  /** Legacy user-token / dev keys from the old design — flagged by env:audit, never the production model. */
  legacyUserTokenKeys: string[];
  redirectUriEnv?: string;
  supportsRefreshToken: boolean;
  supportsMultipleAccounts: boolean;
  active?: boolean;
  notes?: string;
  // ── Back-compat aliases (derived) ──
  /** @deprecated alias for appRequired — app-level credentials, not user tokens. */
  required: string[];
  /** @deprecated alias for appOptional. */
  optional: string[];
  /** @deprecated alias for devShortcut. */
  advanced: string[];
}

export interface EnvValidationResult {
  providerId: string;
  /** True when app-level developer setup is present (or none is required). */
  configured: boolean;
  missing: string[];
  invalidPlaceholders: string[];
  required: string[];
  optional: string[];
  advanced: string[];
}

export const CORE_ENV_KEYS = [
  'LARUND_ENV',
  'LARUND_APP_URL',
  'LARUND_API_URL',
  'LARUND_CONNECTIONS_STRICT',
  'LARUND_ALLOW_MOCK_CONNECTIONS',
  'LARUND_ENABLE_DEV_PAT_SHORTCUTS',
  'LARUND_AUTH_EXCHANGE_MODE',
  'LARUND_OAUTH_CALLBACK_BASE',
];

type RawSchema = Omit<ProviderEnvSchema, 'required' | 'optional' | 'advanced'>;

function def(
  providerId: string,
  authMode: ProviderAuthMode,
  appRequired: string[],
  opts: Partial<Omit<RawSchema, 'providerId' | 'authMode' | 'appRequired'>> = {},
): RawSchema {
  return {
    providerId,
    authMode,
    appRequired,
    appOptional: opts.appOptional ?? [],
    userCredentialStorage:
      opts.userCredentialStorage ??
      (authMode === 'mcp_url'
        ? 'mcp_server_config'
        : authMode === 'api_key_user_entered' || authMode === 'pat_user_entered'
          ? 'secure_user_secret'
          : authMode === 'none'
            ? 'none'
            : 'connected_account_store'),
    devShortcut: opts.devShortcut ?? [],
    legacyUserTokenKeys: opts.legacyUserTokenKeys ?? [],
    redirectUriEnv: opts.redirectUriEnv,
    supportsRefreshToken: opts.supportsRefreshToken ?? false,
    supportsMultipleAccounts: opts.supportsMultipleAccounts ?? true,
    active: opts.active,
    notes: opts.notes,
  };
}

const RAW_PROVIDER_ENV: Record<string, RawSchema> = {
  // ── OAuth providers: app creds in .env, user tokens in ConnectedAccount store ──
  // Redirect URI is a single shared loopback (LARUND_OAUTH_CALLBACK_BASE), so no
  // per-provider *_REDIRECT_URI env key is needed — only CLIENT_ID/SECRET.
  github: def('github', 'oauth2_authorization_code_confidential', ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'], {
    devShortcut: ['DEV_GITHUB_TOKEN'],
    legacyUserTokenKeys: ['GITHUB_TOKEN'],
    active: true,
    notes: 'Configure a GitHub OAuth App once; each user connects their own account with one click. DEV_GITHUB_TOKEN is a single-developer shortcut only.',
  }),
  notion: def('notion', 'oauth2_authorization_code_confidential', ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'], {
    devShortcut: ['DEV_NOTION_TOKEN'],
    legacyUserTokenKeys: ['NOTION_TOKEN'],
    active: true,
    notes: 'Public Notion integration (OAuth). Each user connects their own workspace.',
  }),
  'google-workspace': def('google-workspace', 'oauth2_authorization_code_confidential', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
    supportsRefreshToken: true,
    legacyUserTokenKeys: ['GOOGLE_WORKSPACE_ACCESS_TOKEN', 'GOOGLE_WORKSPACE_REFRESH_TOKEN', 'GOOGLE_WORKSPACE_ACCOUNT_EMAIL'],
    active: true,
    notes: 'One Google OAuth app powers Drive, Docs, Sheets, Gmail and Calendar. User tokens live in the ConnectedAccount store, never in .env.',
  }),
  slack: def('slack', 'oauth2_authorization_code_confidential', ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'], {
    appOptional: ['SLACK_SIGNING_SECRET'],
    devShortcut: ['DEV_SLACK_BOT_TOKEN'],
    legacyUserTokenKeys: ['SLACK_BOT_TOKEN'],
    active: true,
  }),
  discord: def('discord', 'oauth2_authorization_code_confidential', ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'], {
    devShortcut: ['DEV_DISCORD_BOT_TOKEN'],
    legacyUserTokenKeys: ['DISCORD_BOT_TOKEN'],
    active: true,
    notes: 'Discord may also run bot-only in developer mode via DEV_DISCORD_BOT_TOKEN.',
  }),
  x: def('x', 'oauth2_authorization_code_pkce', ['X_CLIENT_ID'], {
    appOptional: ['X_CLIENT_SECRET', 'X_APP_BEARER'],
    supportsRefreshToken: true,
    devShortcut: ['DEV_X_BEARER_TOKEN', 'DEV_X_WRITE_ACCESS_TOKEN', 'DEV_X_WRITE_ACCESS_TOKEN_SECRET'],
    legacyUserTokenKeys: ['X_BEARER_TOKEN', 'X_WRITE_ACCESS_TOKEN', 'X_WRITE_ACCESS_TOKEN_SECRET', 'X_API_KEY', 'X_API_SECRET'],
    active: true,
    notes: 'OAuth2 PKCE. User tokens live in ConnectedAccount storage. X_APP_BEARER enables app-only read/search for users who have not connected X yet; DEV_X_BEARER_TOKEN is a development shortcut.',
  }),
  'microsoft-365': def('microsoft-365', 'oauth2_authorization_code_confidential', ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'], {
    supportsRefreshToken: true,
    legacyUserTokenKeys: ['MICROSOFT_ACCESS_TOKEN', 'MICROSOFT_REFRESH_TOKEN'],
    active: false,
  }),
  'meta-ads': def('meta-ads', 'oauth2_authorization_code_confidential', ['META_APP_ID', 'META_APP_SECRET'], {
    legacyUserTokenKeys: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_BUSINESS_ID', 'META_PAGE_ID', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'],
    active: false,
    notes: 'Per-user/page/ad-account tokens and selected business/ad-account IDs live on the ConnectedAccount, not in .env.',
  }),
  'instagram-business': def('instagram-business', 'oauth2_authorization_code_confidential', ['META_APP_ID', 'META_APP_SECRET'], { active: false }),
  'facebook-pages': def('facebook-pages', 'oauth2_authorization_code_confidential', ['META_APP_ID', 'META_APP_SECRET'], { active: false }),
  'google-ads': def('google-ads', 'oauth2_authorization_code_confidential', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
    supportsRefreshToken: true, active: false,
    notes: 'Uses the Google OAuth app. Selected customer ID is stored per connected account, plus an app-level GOOGLE_ADS_DEVELOPER_TOKEN.',
  }),
  ga4: def('ga4', 'oauth2_authorization_code_confidential', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
    supportsRefreshToken: true, active: false,
    notes: 'Uses the Google OAuth app. The selected GA4 property ID is stored per connected account, not in .env.',
  }),
  'search-console': def('search-console', 'oauth2_authorization_code_confidential', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], {
    supportsRefreshToken: true, active: false,
    notes: 'Uses the Google OAuth app. The selected site URL is stored per connected account, not in .env.',
  }),

  // ── API-key / PAT providers: NO developer .env required; user enters their own key ──
  airtable: def('airtable', 'pat_user_entered', [], { devShortcut: ['DEV_AIRTABLE_TOKEN'], legacyUserTokenKeys: ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID'], active: true }),
  linear: def('linear', 'api_key_user_entered', [], { devShortcut: ['DEV_LINEAR_API_KEY'], legacyUserTokenKeys: ['LINEAR_API_KEY'], active: true }),
  hubspot: def('hubspot', 'pat_user_entered', [], { devShortcut: ['DEV_HUBSPOT_PRIVATE_APP_TOKEN'], legacyUserTokenKeys: ['HUBSPOT_PRIVATE_APP_TOKEN'], active: true }),
  billingo: def('billingo', 'api_key_user_entered', [], { devShortcut: ['DEV_BILLINGO_API_KEY'], legacyUserTokenKeys: ['BILLINGO_API_KEY'], active: true }),
  woocommerce: def('woocommerce', 'api_key_user_entered', [], { devShortcut: ['DEV_WOOCOMMERCE_STORE_URL', 'DEV_WOOCOMMERCE_CONSUMER_KEY', 'DEV_WOOCOMMERCE_CONSUMER_SECRET'], legacyUserTokenKeys: ['WOOCOMMERCE_STORE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'], active: true }),
  wordpress: def('wordpress', 'api_key_user_entered', [], { devShortcut: ['DEV_WORDPRESS_SITE_URL', 'DEV_WORDPRESS_USERNAME', 'DEV_WORDPRESS_APP_PASSWORD'], legacyUserTokenKeys: ['WORDPRESS_SITE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'], active: true }),
  resend: def('resend', 'api_key_user_entered', [], { devShortcut: ['DEV_RESEND_API_KEY'], legacyUserTokenKeys: ['RESEND_API_KEY'], active: true }),
  sendgrid: def('sendgrid', 'api_key_user_entered', [], { devShortcut: ['DEV_SENDGRID_API_KEY'], legacyUserTokenKeys: ['SENDGRID_API_KEY'], active: true }),
  supabase: def('supabase', 'api_key_user_entered', [], { devShortcut: ['DEV_SUPABASE_URL', 'DEV_SUPABASE_SERVICE_ROLE_KEY'], legacyUserTokenKeys: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'], active: true }),
  vercel: def('vercel', 'api_key_user_entered', [], { devShortcut: ['DEV_VERCEL_TOKEN'], legacyUserTokenKeys: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'], active: true }),
  stripe: def('stripe', 'api_key_user_entered', [], { devShortcut: ['DEV_STRIPE_SECRET_KEY'], legacyUserTokenKeys: ['STRIPE_SECRET_KEY'], active: true }),
  jira: def('jira', 'api_key_user_entered', [], { legacyUserTokenKeys: ['ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN', 'ATLASSIAN_SITE_URL'], active: false }),
  trello: def('trello', 'api_key_user_entered', [], { legacyUserTokenKeys: ['TRELLO_API_KEY', 'TRELLO_TOKEN'], active: false }),
  mailchimp: def('mailchimp', 'api_key_user_entered', [], { legacyUserTokenKeys: ['MAILCHIMP_API_KEY', 'MAILCHIMP_SERVER_PREFIX'], active: false }),
  brevo: def('brevo', 'api_key_user_entered', [], { legacyUserTokenKeys: ['BREVO_API_KEY'], active: false }),
  shopify: def('shopify', 'api_key_user_entered', [], { legacyUserTokenKeys: ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN'], active: false }),
  netlify: def('netlify', 'api_key_user_entered', [], { legacyUserTokenKeys: ['NETLIFY_AUTH_TOKEN'], active: false }),
  cloudflare: def('cloudflare', 'api_key_user_entered', [], { legacyUserTokenKeys: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID'], active: false }),
  sentry: def('sentry', 'api_key_user_entered', [], { legacyUserTokenKeys: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'], active: false }),
  langsmith: def('langsmith', 'api_key_user_entered', [], { legacyUserTokenKeys: ['LANGSMITH_API_KEY', 'LANGSMITH_ENDPOINT'], active: false }),
  figma: def('figma', 'api_key_user_entered', [], { legacyUserTokenKeys: ['FIGMA_ACCESS_TOKEN'], active: false }),
  canva: def('canva', 'oauth2_authorization_code_confidential', [], { appOptional: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'], legacyUserTokenKeys: ['CANVA_ACCESS_TOKEN', 'CANVA_REFRESH_TOKEN'], active: false }),
  webflow: def('webflow', 'api_key_user_entered', [], { appOptional: ['WEBFLOW_CLIENT_ID', 'WEBFLOW_CLIENT_SECRET'], legacyUserTokenKeys: ['WEBFLOW_ACCESS_TOKEN', 'WEBFLOW_SITE_ID'], active: false }),
  framer: def('framer', 'api_key_user_entered', [], { legacyUserTokenKeys: ['FRAMER_API_KEY'], active: false }),

  // ── MCP-backed providers: app-level default server URL; user token lives in MCP server config ──
  higgsfield: def('higgsfield', 'mcp_url', ['HIGGSFIELD_MCP_URL'], { active: true }),
  'canva-mcp': def('canva-mcp', 'mcp_url', ['CANVA_MCP_URL'], { active: true }),
  'figma-mcp': def('figma-mcp', 'mcp_url', ['FIGMA_MCP_URL'], { active: true }),
  'linear-mcp': def('linear-mcp', 'mcp_url', ['LINEAR_MCP_URL'], { active: true }),
  'supabase-mcp': def('supabase-mcp', 'mcp_url', ['SUPABASE_MCP_URL'], { active: true }),
  'vercel-mcp': def('vercel-mcp', 'mcp_url', ['VERCEL_MCP_URL'], { active: true }),
  'custom-mcp': def('custom-mcp', 'mcp_url', [], { active: true }),
};

function withAliases(raw: RawSchema): ProviderEnvSchema {
  return { ...raw, required: raw.appRequired, optional: raw.appOptional, advanced: raw.devShortcut };
}

export const PROVIDER_ENV: Record<string, ProviderEnvSchema> = Object.fromEntries(
  Object.entries(RAW_PROVIDER_ENV).map(([id, raw]) => [id, withAliases(raw)]),
);

export function envSchemaForProvider(providerId: string): ProviderEnvSchema {
  const raw = RAW_PROVIDER_ENV[providerId];
  if (raw) return withAliases(raw);
  return withAliases(def(providerId, 'none', []));
}

// ── App-level env sections (the only thing sync writes to .env) ──

export const APP_ENV_SECTIONS: Array<{ title: string; keys: string[] }> = [
  { title: 'Larund core', keys: CORE_ENV_KEYS },
  { title: 'Google OAuth app', keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  { title: 'GitHub OAuth app', keys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] },
  { title: 'Notion OAuth app', keys: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'] },
  { title: 'Slack OAuth app', keys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'] },
  { title: 'X / Twitter OAuth app', keys: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_APP_BEARER'] },
  { title: 'Meta app', keys: ['META_APP_ID', 'META_APP_SECRET'] },
  { title: 'Microsoft OAuth app', keys: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'] },
  { title: 'Discord app', keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] },
  { title: 'MCP provider URLs', keys: ['HIGGSFIELD_MCP_URL', 'CANVA_MCP_URL', 'FIGMA_MCP_URL', 'LINEAR_MCP_URL', 'SUPABASE_MCP_URL', 'VERCEL_MCP_URL'] },
];

export const APP_ENV_DEFAULTS: Record<string, string> = {
  LARUND_ENV: 'development',
  LARUND_APP_URL: 'http://localhost:1420',
  LARUND_API_URL: 'http://localhost:1420',
  LARUND_CONNECTIONS_STRICT: 'true',
  LARUND_ALLOW_MOCK_CONNECTIONS: 'false',
  LARUND_ENABLE_DEV_PAT_SHORTCUTS: 'false',
  LARUND_AUTH_EXCHANGE_MODE: 'local_dev',
  // Single shared desktop loopback redirect; register this exact value (with the
  // trailing slash) in every provider's OAuth console.
  LARUND_OAUTH_CALLBACK_BASE: 'http://localhost:14200',
  MICROSOFT_TENANT_ID: 'common',
};

/** DEV_* shortcut keys, only written to .env with --include-dev-shortcuts. */
export const DEV_SHORTCUT_KEYS = [
  ...new Set(Object.values(RAW_PROVIDER_ENV).flatMap((s) => s.devShortcut)),
];

/** Old user-token / dev keys from the previous design (flagged by env:audit, never auto-deleted). */
export const LEGACY_USER_TOKEN_KEYS = [
  ...new Set(Object.values(RAW_PROVIDER_ENV).flatMap((s) => s.legacyUserTokenKeys)),
];

/** Every app-level key sync may write (no user tokens, no DEV_* shortcuts). */
export const APP_ENV_KEYS = [...new Set(APP_ENV_SECTIONS.flatMap((s) => s.keys))];

/** Back-compat alias used by tests/UI: app-level keys only. */
export const ACTIVE_ENV_KEYS = APP_ENV_KEYS;

export function allConnectionEnvKeys(): string[] {
  return [...new Set([...APP_ENV_KEYS, ...DEV_SHORTCUT_KEYS])].sort();
}

function hasValid(env: Record<string, string | undefined>, key: string): boolean {
  const value = env[key];
  return typeof value === 'string' && !isPlaceholderSecret(value);
}

/**
 * Validate APP-LEVEL developer setup for a provider. `configured` here means the
 * developer credentials needed to start a connection are present — NOT that any
 * user has connected.
 */
export function validateProviderEnv(providerId: string, env: Record<string, string | undefined>): EnvValidationResult {
  const schema = envSchemaForProvider(providerId);
  const keys = [...schema.appRequired, ...schema.appOptional];
  const invalidPlaceholders = keys.filter((key) => typeof env[key] === 'string' && isPlaceholderSecret(env[key]));
  const missing = schema.appRequired.filter((key) => !hasValid(env, key));
  return {
    providerId,
    configured: missing.length === 0 && invalidPlaceholders.length === 0,
    missing,
    invalidPlaceholders,
    required: schema.appRequired,
    optional: schema.appOptional,
    advanced: schema.devShortcut,
  };
}

/** Map a legacy user-token key to the DEV_* shortcut it should migrate to (if any). */
export function legacyKeyMigrationTarget(legacyKey: string): string | null {
  for (const schema of Object.values(RAW_PROVIDER_ENV)) {
    if (!schema.legacyUserTokenKeys.includes(legacyKey)) continue;
    // Direct DEV_<KEY> shortcut?
    const direct = `DEV_${legacyKey}`;
    if (schema.devShortcut.includes(direct)) return direct;
    if (schema.devShortcut.length === 1) return schema.devShortcut[0];
    return null;
  }
  return null;
}
