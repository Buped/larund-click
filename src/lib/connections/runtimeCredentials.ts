// Runtime credential resolution for provider tool execution.
//
// Resolution order (spec §14) for a provider call by the current user:
//   1. ConnectedAccount for the current user  → use the encrypted user token.
//   2. Developer Mode + DEV_* shortcut enabled → use the DEV_* token.
//   3. MCP-backed and configured               → defer to approved MCP tools.
//   4. Otherwise                                → blocker (developer_setup_missing
//                                                 or missing_connection).
//
// The agent NEVER uses app-level client secrets as a user token, and never treats
// a provider as connected just because client id/secret exist.

import { envSchemaForProvider } from './env/schema';
import { getProviderSecret, isDeveloperSetupReady, devPatShortcutsEnabled, getMissingAppCredentials } from './env/resolve';
import {
  getConnectedAccount,
  getTokenSecretForProviderCall,
  DEFAULT_CONTEXT,
  type ConnectionContext,
  type ConnectedAccount,
} from './connectedAccounts';

export type CredentialSource = 'connected_account' | 'dev_shortcut' | 'mcp' | 'none';

export type CredentialBlocker =
  | 'developer_setup_missing'
  | 'not_connected'
  | 'insufficient_scope'
  | 'expired'
  | 'revoked'
  | 'needs_reconnect';

export interface ResolvedCredentials {
  ok: boolean;
  source: CredentialSource;
  /** Secrets map keyed by the env names provider tools already read. */
  secrets: Record<string, string>;
  /** Set when ok === false. */
  blocker?: CredentialBlocker;
  message?: string;
  account?: ConnectedAccount;
}

/** Env keys a provider's tools read for the user access token. */
const ACCESS_TOKEN_TOOL_KEYS: Record<string, string[]> = {
  github: ['GITHUB_TOKEN'],
  notion: ['NOTION_TOKEN'],
  slack: ['SLACK_BOT_TOKEN'],
  discord: ['DISCORD_BOT_TOKEN'],
  'google-workspace': ['GOOGLE_WORKSPACE_ACCESS_TOKEN'],
  x: ['X_BEARER_TOKEN', 'X_WRITE_ACCESS_TOKEN'],
  airtable: ['AIRTABLE_TOKEN'],
  linear: ['LINEAR_API_KEY'],
  hubspot: ['HUBSPOT_PRIVATE_APP_TOKEN'],
  resend: ['RESEND_API_KEY'],
  sendgrid: ['SENDGRID_API_KEY'],
  vercel: ['VERCEL_TOKEN'],
  stripe: ['STRIPE_SECRET_KEY'],
};

function toolTokenKeys(providerId: string): string[] {
  return ACCESS_TOKEN_TOOL_KEYS[providerId] ?? [`${providerId.toUpperCase().replace(/-/g, '_')}_TOKEN`];
}

/** App-level developer credentials (never user tokens), always safe to expose to flows that need them. */
function appCredentials(providerId: string): Record<string, string> {
  const schema = envSchemaForProvider(providerId);
  const out: Record<string, string> = {};
  for (const key of [...schema.appRequired, ...schema.appOptional]) {
    const v = getProviderSecret(providerId, key);
    if (v) out[key] = v;
  }
  return out;
}

export async function resolveRuntimeCredentials(
  providerId: string,
  ctx: ConnectionContext = DEFAULT_CONTEXT,
): Promise<ResolvedCredentials> {
  const schema = envSchemaForProvider(providerId);
  const appCreds = appCredentials(providerId);

  // MCP providers: the "credential" is the configured server URL; tokens live in
  // the MCP server config, not here.
  if (schema.authMode === 'mcp_url') {
    return isDeveloperSetupReady(providerId)
      ? { ok: true, source: 'mcp', secrets: appCreds }
      : { ok: false, source: 'none', secrets: {}, blocker: 'developer_setup_missing', message: `Configure ${schema.appRequired.join(', ')} (MCP server URL) first.` };
  }

  // 1) Connected account for the current user.
  const account = getConnectedAccount(providerId, ctx);
  if (account) {
    if (account.status !== 'connected') {
      // Surface the precise reason so Chat/Tasks can offer the right action.
      const blocker: CredentialBlocker =
        account.status === 'expired' ? 'expired'
        : account.status === 'revoked' ? 'revoked'
        : account.status === 'insufficient_scope' ? 'insufficient_scope'
        : 'needs_reconnect';
      return { ok: false, source: 'none', secrets: appCreds, blocker, account,
        message: `Your ${providerId} connection is ${account.status}. Reconnect it.` };
    }
    const token = await getTokenSecretForProviderCall(account.tokenRef);
    if (token) {
      const secrets = { ...appCreds };
      for (const key of toolTokenKeys(providerId)) secrets[key] = token;
      if (account.externalAccountEmail) secrets.GOOGLE_WORKSPACE_ACCOUNT_EMAIL = account.externalAccountEmail;
      return { ok: true, source: 'connected_account', secrets, account };
    }
  }

  // 2) Developer Mode + DEV_* shortcut.
  if (devPatShortcutsEnabled() && schema.devShortcut.length) {
    const secrets = { ...appCreds };
    let any = false;
    for (const devKey of schema.devShortcut) {
      const value = getProviderSecret(providerId, devKey);
      if (!value) continue;
      any = true;
      // DEV_GITHUB_TOKEN → GITHUB_TOKEN, DEV_WORDPRESS_SITE_URL → WORDPRESS_SITE_URL, …
      secrets[devKey.replace(/^DEV_/, '')] = value;
    }
    if (any) return { ok: true, source: 'dev_shortcut', secrets };
  }

  // 3/4) Blocker. Distinguish "developer hasn't configured the app" from
  // "this user hasn't connected yet".
  const needsAppSetup = schema.appRequired.length > 0 && !isDeveloperSetupReady(providerId);
  if (needsAppSetup) {
    return { ok: false, source: 'none', secrets: appCreds, blocker: 'developer_setup_missing',
      message: `Larund developer credentials for ${providerId} are not configured (${getMissingAppCredentials(providerId).join(', ')}).` };
  }
  return { ok: false, source: 'none', secrets: appCreds, blocker: 'not_connected',
    message: `No ${providerId} account is connected for this user. Connect one first.` };
}
