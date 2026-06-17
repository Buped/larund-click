// Audit `.env` against the app-level credential model.
//
// Prints:
//   • app-level credentials missing (per provider);
//   • providers ready to connect (app creds present / none required);
//   • providers blocked by missing developer setup;
//   • legacy user-token / dev-shortcut keys that should be migrated out of .env.
//
// Self-contained (no src imports) so it runs under `node scripts/env-audit.ts`.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');

// providerId → app-level required OAuth credentials (empty = user enters their own key).
// Redirect URI is the single shared loopback (LARUND_OAUTH_CALLBACK_BASE), not per provider.
const APP_REQUIRED: Record<string, string[]> = {
  'Google Workspace': ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  GitHub: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  Notion: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
  Slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  Discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
  'X / Twitter': ['X_CLIENT_ID'],
  Meta: ['META_APP_ID', 'META_APP_SECRET'],
  'Microsoft 365': ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID'],
};

// Providers where the user supplies their own key (no developer .env required).
const USER_KEY_PROVIDERS = ['Airtable', 'Linear', 'HubSpot', 'WordPress', 'Resend', 'SendGrid', 'Supabase', 'Vercel', 'Cloudflare', 'Sentry', 'LangSmith', 'Mailchimp', 'Brevo', 'Stripe'];


const LEGACY_USER_TOKEN_KEYS = [
  'GITHUB_TOKEN', 'NOTION_TOKEN', 'SLACK_BOT_TOKEN', 'DISCORD_BOT_TOKEN',
  'GOOGLE_WORKSPACE_ACCESS_TOKEN', 'GOOGLE_WORKSPACE_REFRESH_TOKEN', 'GOOGLE_WORKSPACE_ACCOUNT_EMAIL',
  'X_BEARER_TOKEN', 'X_WRITE_ACCESS_TOKEN', 'X_WRITE_ACCESS_TOKEN_SECRET', 'X_API_KEY', 'X_API_SECRET',
  'META_ACCESS_TOKEN', 'MICROSOFT_ACCESS_TOKEN', 'MICROSOFT_REFRESH_TOKEN',
  'AIRTABLE_TOKEN', 'LINEAR_API_KEY', 'HUBSPOT_PRIVATE_APP_TOKEN', 'RESEND_API_KEY',
  'SENDGRID_API_KEY', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
];

const PLACEHOLDER = /^(|changeme|change_me|todo|<.*>|\[.*\])$/i;

function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

function present(values: Map<string, string>, key: string): boolean {
  const v = values.get(key);
  return typeof v === 'string' && v.length > 0 && !PLACEHOLDER.test(v);
}

const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
if (!text) {
  console.log('No .env found. Run `npm run env:sync` to create one.');
  process.exit(0);
}
const values = parseEnv(text);

const ready: string[] = [];
const blocked: Array<{ provider: string; missing: string[] }> = [];
for (const [provider, keys] of Object.entries(APP_REQUIRED)) {
  const missing = keys.filter((k) => !present(values, k));
  if (missing.length) blocked.push({ provider, missing });
  else ready.push(provider);
}

console.log('Larund connections — env audit\n');
console.log('OAuth providers ready to connect (app creds present):');
console.log(ready.length ? ready.map((p) => `  ✓ ${p}`).join('\n') : '  (none)');

console.log('\nOAuth providers blocked — developer setup missing:');
console.log(blocked.length ? blocked.map((b) => `  ✗ ${b.provider} — set ${b.missing.join(', ')}`).join('\n') : '  (none)');

console.log('\nUser-key providers — api_key_required (no developer .env needed; user enters their own key):');
console.log('  ' + USER_KEY_PROVIDERS.join(', '));

// Single shared loopback redirect: LARUND_OAUTH_CALLBACK_BASE must be a localhost
// loopback origin. Register `<base>/` in every provider's OAuth console.
const callbackBase = values.get('LARUND_OAUTH_CALLBACK_BASE') ?? '';
console.log('\nDesktop loopback redirect (register `<base>/` in every provider console):');
let baseOk = false;
try {
  const u = new URL(callbackBase);
  baseOk = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
} catch { baseOk = false; }
if (baseOk) {
  console.log(`  ✓ LARUND_OAUTH_CALLBACK_BASE=${callbackBase} → register ${callbackBase.replace(/\/+$/, '')}/`);
} else {
  console.log(`  ⚠ LARUND_OAUTH_CALLBACK_BASE must be a localhost loopback origin (e.g. http://localhost:14200); got "${callbackBase || '(unset)'}"`);
}

const legacyPresent = LEGACY_USER_TOKEN_KEYS.filter((k) => values.has(k) && (values.get(k) ?? '').length > 0);
console.log('\nUser-token / dev-shortcut keys to migrate out of .env:');
if (legacyPresent.length) {
  for (const k of legacyPresent) console.log(`  ⚠ ${k}`);
  console.log('\n  These are user-token or dev-shortcut values. Move them to the ConnectedAccount');
  console.log('  store (regenerate via OAuth), or rename to DEV_* for single-developer testing.');
  console.log('  Google user tokens must be regenerated through OAuth — do not migrate them silently.');
} else {
  console.log('  (none — clean)');
}
