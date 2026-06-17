// Generate / reconcile `.env` with APP-LEVEL developer credentials only.
//
//   • Writes app-level provider credentials (OAuth client id/secret, redirect
//     URIs, MCP URLs) and Larund core settings.
//   • NEVER writes user access/refresh tokens — those live in the ConnectedAccount
//     store, not .env.
//   • DEV_* personal-token shortcuts are written ONLY with --include-dev-shortcuts.
//   • Preserves existing values, removes duplicate keys, --prune drops unknown keys.
//
// This file is intentionally self-contained (no src imports) so it runs under
// `node scripts/sync-env.ts` without a bundler. Keep the sections in sync with
// src/lib/connections/env/schema.ts (APP_ENV_SECTIONS / DEV_SHORTCUT_KEYS).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');

const APP_SECTIONS = [
  { title: 'Larund core', keys: ['LARUND_ENV', 'LARUND_APP_URL', 'LARUND_API_URL', 'LARUND_CONNECTIONS_STRICT', 'LARUND_ALLOW_MOCK_CONNECTIONS', 'LARUND_ENABLE_DEV_PAT_SHORTCUTS', 'LARUND_AUTH_EXCHANGE_MODE', 'LARUND_OAUTH_CALLBACK_BASE'] },
  { title: 'Google OAuth app', keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  { title: 'GitHub OAuth app', keys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] },
  { title: 'Notion OAuth app', keys: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'] },
  { title: 'Slack OAuth app', keys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'] },
  { title: 'X / Twitter OAuth app', keys: ['X_CLIENT_ID', 'X_CLIENT_SECRET'] },
  { title: 'Meta app', keys: ['META_APP_ID', 'META_APP_SECRET'] },
  { title: 'Microsoft OAuth app', keys: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'] },
  { title: 'Discord app', keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] },
  { title: 'MCP provider URLs', keys: ['HIGGSFIELD_MCP_URL', 'CANVA_MCP_URL', 'FIGMA_MCP_URL', 'LINEAR_MCP_URL', 'SUPABASE_MCP_URL', 'VERCEL_MCP_URL'] },
];

const DEV_SHORTCUT_KEYS = [
  'DEV_GITHUB_TOKEN', 'DEV_NOTION_TOKEN', 'DEV_SLACK_BOT_TOKEN', 'DEV_DISCORD_BOT_TOKEN',
  'DEV_X_BEARER_TOKEN', 'DEV_X_WRITE_ACCESS_TOKEN', 'DEV_X_WRITE_ACCESS_TOKEN_SECRET',
  'DEV_AIRTABLE_TOKEN', 'DEV_LINEAR_API_KEY', 'DEV_HUBSPOT_PRIVATE_APP_TOKEN',
  'DEV_WORDPRESS_SITE_URL', 'DEV_WORDPRESS_USERNAME', 'DEV_WORDPRESS_APP_PASSWORD',
  'DEV_RESEND_API_KEY', 'DEV_SENDGRID_API_KEY', 'DEV_SUPABASE_URL', 'DEV_SUPABASE_SERVICE_ROLE_KEY',
  'DEV_VERCEL_TOKEN', 'DEV_STRIPE_SECRET_KEY',
];

// Old user-token / dev-shortcut keys from the previous design — never written;
// flagged so a developer can migrate them out of .env.
const LEGACY_USER_TOKEN_KEYS = [
  'GITHUB_TOKEN', 'NOTION_TOKEN', 'SLACK_BOT_TOKEN', 'DISCORD_BOT_TOKEN',
  'GOOGLE_WORKSPACE_ACCESS_TOKEN', 'GOOGLE_WORKSPACE_REFRESH_TOKEN', 'GOOGLE_WORKSPACE_ACCOUNT_EMAIL',
  'X_BEARER_TOKEN', 'X_WRITE_ACCESS_TOKEN', 'X_WRITE_ACCESS_TOKEN_SECRET', 'X_API_KEY', 'X_API_SECRET',
  'META_ACCESS_TOKEN', 'MICROSOFT_ACCESS_TOKEN', 'MICROSOFT_REFRESH_TOKEN',
];

const DEFAULTS: Record<string, string> = {
  LARUND_ENV: 'development',
  LARUND_APP_URL: 'http://localhost:1420',
  LARUND_API_URL: 'http://localhost:1420',
  LARUND_CONNECTIONS_STRICT: 'true',
  LARUND_ALLOW_MOCK_CONNECTIONS: 'false',
  LARUND_ENABLE_DEV_PAT_SHORTCUTS: 'false',
  LARUND_AUTH_EXCHANGE_MODE: 'local_dev',
  LARUND_OAUTH_CALLBACK_BASE: 'http://localhost:14200',
  MICROSOFT_TENANT_ID: 'common',
};

const includeDevShortcuts = process.argv.includes('--include-dev-shortcuts');
const prune = process.argv.includes('--prune');

const sections = includeDevShortcuts
  ? [...APP_SECTIONS, { title: 'Developer-only PAT shortcuts (single-developer testing only)', keys: DEV_SHORTCUT_KEYS }]
  : APP_SECTIONS;

const managedKeys = new Set(sections.flatMap((s) => s.keys));
// DEV_* keys are "known" even when not being written, so they aren't treated as unknown/pruned.
const knownKeys = new Set([...managedKeys, ...DEV_SHORTCUT_KEYS]);

function parseEnv(text: string) {
  const values = new Map<string, string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (values.has(key)) duplicates.push(key);
    else values.set(key, value);
    if (!knownKeys.has(key)) unknown.push(key);
  }
  return { values, duplicates, unknown: [...new Set(unknown)] };
}

function render(values: Map<string, string>, preservedUnknown: Array<[string, string]>) {
  const chunks: string[] = [];
  for (const section of sections) {
    chunks.push(`# ${section.title}`, '');
    for (const key of section.keys) chunks.push(`${key}=${values.get(key) ?? DEFAULTS[key] ?? ''}`);
    chunks.push('');
  }
  if (!prune && preservedUnknown.length) {
    chunks.push('# Preserved local-only keys (not managed by env:sync)', '');
    for (const [key, value] of preservedUnknown) chunks.push(`${key}=${value}`);
    chunks.push('');
  }
  return `${chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const existingText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
const parsed = parseEnv(existingText);
const added: string[] = [];
const preserved: string[] = [];

for (const key of managedKeys) {
  if (parsed.values.has(key)) preserved.push(key);
  else { parsed.values.set(key, DEFAULTS[key] ?? ''); added.push(key); }
}

const preservedUnknown = prune ? [] : parsed.unknown.map((key) => [key, parsed.values.get(key) ?? ''] as [string, string]);
fs.writeFileSync(ENV_PATH, render(parsed.values, preservedUnknown), 'utf8');

const legacyPresent = LEGACY_USER_TOKEN_KEYS.filter((k) => parsed.values.has(k));

console.log(`env:sync wrote ${path.relative(ROOT, ENV_PATH)}${includeDevShortcuts ? ' (with DEV_* shortcuts)' : ''}`);
console.log(`added keys: ${added.length ? added.join(', ') : 'none'}`);
console.log(`preserved keys: ${preserved.length}`);
console.log(`duplicate keys removed: ${parsed.duplicates.length ? [...new Set(parsed.duplicates)].join(', ') : 'none'}`);
if (!includeDevShortcuts) console.log('DEV_* shortcut keys skipped (pass --include-dev-shortcuts to add them).');
if (legacyPresent.length) {
  console.warn(`WARNING: legacy user-token keys present in .env: ${legacyPresent.join(', ')}`);
  console.warn('  These are user-token or dev-shortcut values. Move them to the ConnectedAccount store, or rename to DEV_* for local testing. Run `npm run env:audit` for details. (Not deleted automatically.)');
}
if (!prune && preservedUnknown.length) console.log(`unknown local keys preserved: ${preservedUnknown.map(([k]) => k).join(', ')}`);
