// Provider auth model. Distinguishes APP-LEVEL developer credentials (what the
// developer configures once, in .env / backend) from USER-LEVEL connected-account
// tokens (created per user via Connect, stored in the ConnectedAccount store).
//
// `appCredentials.requiredEnv` is developer config ONLY. It never means a user
// token, and the presence of app credentials never implies a user is connected.

import type { ProviderAuthMode, UserCredentialStorage } from './env/schema';
import { envSchemaForProvider } from './env/schema';

export type { ProviderAuthMode, UserCredentialStorage };

export interface ProviderScope {
  scope: string;
  description?: string;
  /** Enables write/send tools; runtime keeps these approval-gated. */
  write?: boolean;
}

export interface ProviderAuthConfig {
  providerId: string;
  authMode: ProviderAuthMode;
  appCredentials: {
    /** App-level developer config required to enable Connect. NEVER user tokens. */
    requiredEnv: string[];
    optionalEnv: string[];
  };
  /** Where the connected user's tokens are stored. */
  userCredentialStorage: UserCredentialStorage;
  scopes: ProviderScope[];
  redirectUriEnv?: string;
  supportsRefreshToken: boolean;
  supportsIncrementalScopes: boolean;
  supportsMultipleAccounts: boolean;
  /** How a user connects: OAuth Connect button, a user-entered API key, or an MCP URL. */
  supportsOAuth: boolean;
  supportsUserApiKey: boolean;
  supportsMcp: boolean;
  /** DEV_* single-developer shortcut keys (Developer Mode only). */
  devShortcutEnv: string[];
  /** Old user-token keys flagged for migration out of .env. */
  legacyUserTokenKeys: string[];
}

const SCOPES: Record<string, ProviderScope[]> = {
  'google-workspace': [
    { scope: 'https://www.googleapis.com/auth/userinfo.email', description: 'Identify the connected account' },
    { scope: 'https://www.googleapis.com/auth/drive', description: 'Drive read/write (incl. search of existing files)', write: true },
    { scope: 'https://www.googleapis.com/auth/spreadsheets', description: 'Sheets read/write', write: true },
    { scope: 'https://www.googleapis.com/auth/documents', description: 'Docs read/write', write: true },
    { scope: 'https://www.googleapis.com/auth/gmail.modify', description: 'Gmail read/label/draft/send', write: true },
    { scope: 'https://www.googleapis.com/auth/calendar', description: 'Calendar read/write', write: true },
  ],
  github: [
    { scope: 'repo', description: 'Read/write repository content', write: true },
    { scope: 'read:user', description: 'Identify the connected account' },
  ],
  notion: [{ scope: 'workspace', description: 'Read/write shared pages and databases', write: true }],
  slack: [
    { scope: 'channels:read', description: 'List/read channels' },
    { scope: 'chat:write', description: 'Post messages', write: true },
  ],
  x: [
    { scope: 'tweet.read', description: 'Read posts' },
    { scope: 'users.read', description: 'Read the connected user' },
    { scope: 'tweet.write', description: 'Post/reply/delete', write: true },
    { scope: 'offline.access', description: 'Refresh token for long-lived access' },
  ],
};

export function getProviderAuthConfig(providerId: string): ProviderAuthConfig {
  const schema = envSchemaForProvider(providerId);
  const isOAuth = schema.authMode.startsWith('oauth');
  return {
    providerId,
    authMode: schema.authMode,
    appCredentials: { requiredEnv: schema.appRequired, optionalEnv: schema.appOptional },
    userCredentialStorage: schema.userCredentialStorage,
    scopes: SCOPES[providerId] ?? [],
    redirectUriEnv: schema.redirectUriEnv,
    supportsRefreshToken: schema.supportsRefreshToken,
    supportsIncrementalScopes: schema.authMode.startsWith('oauth2'),
    supportsMultipleAccounts: schema.supportsMultipleAccounts,
    supportsOAuth: isOAuth,
    supportsUserApiKey: schema.authMode === 'api_key_user_entered' || schema.authMode === 'pat_user_entered',
    supportsMcp: schema.authMode === 'mcp_url',
    devShortcutEnv: schema.devShortcut,
    legacyUserTokenKeys: schema.legacyUserTokenKeys,
  };
}

/** True when the provider needs a real OAuth/token flow to connect a user. */
export function requiresUserConnection(providerId: string): boolean {
  const mode = envSchemaForProvider(providerId).authMode;
  return mode !== 'none';
}
