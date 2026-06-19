import { describe, it, expect, beforeEach, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { createApp, listApps, getApp, deleteApp, appStatus, __resetAppsForTests } from '../store';
import { __resetCredentialsForTests } from '../../credentials/store';
import {
  validateBrowserProfile, createBrowserProfile, listBrowserProfiles, DEFAULT_BROWSER_PROFILE,
  __resetBrowserProfilesForTests,
} from '../../browser/profiles';
import { listMentionResources } from '../../mentions/resources';
import { resolveReferencedContext } from '../../mentions/resolve';
import { performControlAction } from '../../control-system/executor';
import type { ToolContext } from '../../tools/types';

const ctx = {} as unknown as ToolContext;

beforeEach(() => {
  invokeMock.mockReset();
  __resetAppsForTests();
  __resetCredentialsForTests();
  __resetBrowserProfilesForTests();
});

describe('AppProfile store', () => {
  it('creates an app, links a credential, and reports status', async () => {
    const app = await createApp({ label: 'Shopify Client Store', homeUrl: 'https://admin.shopify.com', username: 'me@x.co', password: 'pw123', usageHints: 'Product edits' });
    expect(app.domain).toBe('admin.shopify.com');
    expect(app.credentialId).toBeTruthy();
    expect(appStatus(app)).toBe('ready');
    expect(listApps()).toHaveLength(1);

    const noPw = await createApp({ label: 'CRM', homeUrl: 'https://crm.test', username: 'u' });
    expect(appStatus(noPw)).toBe('needs_password');

    await deleteApp(app.id);
    expect(getApp(app.id)).toBeUndefined();
  });
});

describe('@App mention', () => {
  it('appears as a mention resource', async () => {
    await createApp({ label: 'WordPress', homeUrl: 'https://blog.test', username: 'u', password: 'p' });
    const items = await listMentionResources({ userId: 'local', kinds: ['app'] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'app', label: 'WordPress', available: true });
  });

  it('resolves to safe metadata only — never the password', async () => {
    const app = await createApp({ label: 'Gmail', homeUrl: 'https://mail.google.com', loginUrl: 'https://accounts.google.com', username: 'me@gmail.com', password: 'SUPERSECRET_pw', usageHints: 'Reply to clients' });
    const resolved = await resolveReferencedContext({
      references: [{ id: 'r1', kind: 'app', label: 'Gmail', refId: app.id, displayText: '@Gmail', insertedAt: new Date().toISOString() }],
      userId: 'local',
    });
    expect(resolved.promptBlock).toContain('## App: Gmail');
    expect(resolved.promptBlock).toContain('credential: saved');
    expect(resolved.promptBlock).not.toContain('SUPERSECRET_pw');
  });
});

describe('browser.login via app_id', () => {
  it('signs in with the app credential and never leaks the password', async () => {
    const app = await createApp({ label: 'Acme', loginUrl: 'https://acme.test/login', username: 'agent@acme.test', password: 'TOPSECRET_pw' });
    invokeMock.mockResolvedValue('ok');
    const res = await performControlAction({ action: 'browser.login', app_id: app.id }, ctx);
    expect(res.success).toBe(true);
    const typeCalls = invokeMock.mock.calls.filter((c) => c[0] === 'browser_type');
    expect(typeCalls.some((c) => (c[1] as { text: string }).text === 'TOPSECRET_pw')).toBe(true);
    expect(JSON.stringify(res)).not.toContain('TOPSECRET_pw');
  });
});

describe('browser profiles', () => {
  it('always offers the managed default', () => {
    expect(listBrowserProfiles()[0]).toMatchObject({ id: DEFAULT_BROWSER_PROFILE.id, kind: 'agent_chrome' });
  });

  it('validates each profile kind', () => {
    expect(validateBrowserProfile({ kind: 'agent_chrome' }).ok).toBe(true);
    expect(validateBrowserProfile({ kind: 'agent_edge' }).ok).toBe(true);
    expect(validateBrowserProfile({ kind: 'existing_cdp', cdpEndpoint: 'http://localhost:9223' }).ok).toBe(true);
    expect(validateBrowserProfile({ kind: 'existing_cdp' }).ok).toBe(false);
    expect(validateBrowserProfile({ kind: 'custom_chromium' }).ok).toBe(false);
    expect(validateBrowserProfile({ kind: 'custom_chromium', executablePath: 'C:/x/chrome.exe' }).ok).toBe(true);
    // Non-Chromium / unknown → honest rejection.
    expect(validateBrowserProfile({ kind: 'firefox' as never }).ok).toBe(false);
  });

  it('creates and lists a custom profile', () => {
    const p = createBrowserProfile({ label: 'Work Edge', kind: 'agent_edge' });
    expect(p.id).toBeTruthy();
    expect(listBrowserProfiles().some((x) => x.id === p.id)).toBe(true);
  });
});
