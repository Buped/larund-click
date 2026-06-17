import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allConnectionEnvKeys, envSchemaForProvider, validateProviderEnv,
  APP_ENV_KEYS, DEV_SHORTCUT_KEYS, LEGACY_USER_TOKEN_KEYS, legacyKeyMigrationTarget,
} from '../env/schema';
import { redactSecrets } from '../../tools/audit';

const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

describe('connection env schema', () => {
  it('.env.example contains every app-level and dev-shortcut key', () => {
    for (const key of allConnectionEnvKeys()) {
      expect(envExample).toContain(`${key}=`);
    }
  });

  it('separates app credentials from a clearly labelled dev-shortcut section', () => {
    const devHeader = '# Developer-only local PAT shortcuts';
    expect(envExample).toContain(devHeader);
    const devSectionStart = envExample.indexOf(devHeader);
    // Every DEV_* key lives below the dev-shortcut header.
    for (const key of DEV_SHORTCUT_KEYS) {
      expect(envExample.indexOf(`${key}=`)).toBeGreaterThan(devSectionStart);
    }
    // App-level OAuth keys live above it.
    for (const key of ['GOOGLE_CLIENT_ID', 'GITHUB_CLIENT_ID', 'X_CLIENT_ID']) {
      expect(envExample.indexOf(`${key}=`)).toBeLessThan(devSectionStart);
    }
  });

  it('uses APP-LEVEL credentials as required, never user tokens', () => {
    // appRequired (alias: required) holds OAuth client creds, not user tokens.
    expect(envSchemaForProvider('github').appRequired).toEqual(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
    expect(envSchemaForProvider('github').required).not.toContain('GITHUB_TOKEN');
    expect(envSchemaForProvider('notion').appRequired).toEqual(['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET']);
    expect(envSchemaForProvider('x').appRequired).toEqual(['X_CLIENT_ID']);
    expect(envSchemaForProvider('x').required).not.toContain('X_WRITE_ACCESS_TOKEN');
    expect(envSchemaForProvider('google-workspace').appRequired).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    // API-key providers need no developer .env — the user enters their own key.
    expect(envSchemaForProvider('linear').appRequired).toEqual([]);
    expect(envSchemaForProvider('linear').authMode).toBe('api_key_user_entered');
  });

  it('no app-level env key is a user access/refresh token', () => {
    const banned = /(ACCESS_TOKEN|REFRESH_TOKEN|BOT_TOKEN|BEARER_TOKEN|_TOKEN$)/;
    for (const key of APP_ENV_KEYS) {
      // Redirect URIs, client ids/secrets, signing secret, MCP urls only.
      expect(banned.test(key)).toBe(false);
    }
  });

  it('flags legacy user-token keys with a migration target', () => {
    expect(LEGACY_USER_TOKEN_KEYS).toEqual(expect.arrayContaining([
      'GITHUB_TOKEN', 'NOTION_TOKEN', 'SLACK_BOT_TOKEN', 'GOOGLE_WORKSPACE_ACCESS_TOKEN', 'X_WRITE_ACCESS_TOKEN',
    ]));
    expect(legacyKeyMigrationTarget('GITHUB_TOKEN')).toBe('DEV_GITHUB_TOKEN');
    expect(legacyKeyMigrationTarget('NOTION_TOKEN')).toBe('DEV_NOTION_TOKEN');
    // Google user tokens are not silently migrated.
    expect(legacyKeyMigrationTarget('GOOGLE_WORKSPACE_ACCESS_TOKEN')).toBeNull();
  });

  it('developer setup validates on app credentials only', () => {
    const missing = validateProviderEnv('github', {});
    expect(missing.configured).toBe(false);
    expect(missing.missing).toContain('GITHUB_CLIENT_ID');

    const ready = validateProviderEnv('github', { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'sec' });
    expect(ready.configured).toBe(true);

    // API-key provider: no developer credentials required → "configured" (ready for user key).
    expect(validateProviderEnv('linear', {}).configured).toBe(true);
  });

  it('rejects placeholder app credentials', () => {
    const result = validateProviderEnv('github', { GITHUB_CLIENT_ID: 'changeme', GITHUB_CLIENT_SECRET: 'sec' });
    expect(result.configured).toBe(false);
    expect(result.invalidPlaceholders).toContain('GITHUB_CLIENT_ID');
  });

  it('redacts secret-looking values from evidence-safe summaries', () => {
    const token = 'Bearer abcdefghijklmnopqrstuvwxyz1234567890';
    expect(redactSecrets(`authorization: ${token}`)).not.toContain(token);
  });
});
