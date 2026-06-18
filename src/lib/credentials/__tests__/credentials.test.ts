import { describe, it, expect, beforeEach, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  createCredential, getCredentialForDomain, resolveCredentialPassword,
  listCredentials, deleteCredential, normalizeDomain, __resetCredentialsForTests,
} from '../store';
import { performControlAction } from '../../control-system/executor';
import type { ToolContext } from '../../tools/types';
import { policyForAutonomyMode } from '../../tools/policy';
import { tauriFetch } from '../../net/tauriFetch';

const ctx = {} as unknown as ToolContext; // browser.login only uses invoke + the vault

beforeEach(() => {
  invokeMock.mockReset();
  __resetCredentialsForTests();
});

describe('credential vault', () => {
  it('stores, matches by domain, resolves the password, and deletes', async () => {
    const c = await createCredential({ label: 'Example', loginUrl: 'https://www.example.com/login', username: 'me@example.com', password: 's3cret!' });
    expect(c.domain).toBe('example.com');
    expect(getCredentialForDomain('https://example.com/anything')?.id).toBe(c.id);
    expect(getCredentialForDomain('app.example.com')?.id).toBe(c.id); // suffix match
    expect(await resolveCredentialPassword(c.id)).toBe('s3cret!');
    await deleteCredential(c.id);
    expect(listCredentials()).toHaveLength(0);
    expect(await resolveCredentialPassword(c.id)).toBeUndefined();
  });

  it('normalizeDomain strips scheme/www/path', () => {
    expect(normalizeDomain('https://www.Foo.com/login?x=1')).toBe('foo.com');
    expect(normalizeDomain('foo.com')).toBe('foo.com');
  });
});

describe('browser.login', () => {
  it('types the saved username + password but never leaks the password to the result', async () => {
    const c = await createCredential({ label: 'Acme', loginUrl: 'https://acme.test/login', username: 'agent@acme.test', password: 'TOPSECRET_pw' });
    invokeMock.mockResolvedValue('ok'); // every browser_* command succeeds

    const res = await performControlAction({ action: 'browser.login', domain: 'acme.test' }, ctx);

    expect(res.success).toBe(true);
    // Username and password were typed via the Rust browser_type command.
    const typeCalls = invokeMock.mock.calls.filter((c2) => c2[0] === 'browser_type');
    expect(typeCalls.some((c2) => (c2[1] as { text: string }).text === 'agent@acme.test')).toBe(true);
    expect(typeCalls.some((c2) => (c2[1] as { text: string }).text === 'TOPSECRET_pw')).toBe(true);
    // The password must never appear in the returned output/error.
    expect(JSON.stringify(res)).not.toContain('TOPSECRET_pw');
    expect(c.lastUsedAt === undefined || typeof c.lastUsedAt === 'string').toBe(true);
  });

  it('fails cleanly when no credential is saved for the domain', async () => {
    const res = await performControlAction({ action: 'browser.login', domain: 'unknown.test' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toBe('no_saved_login_for:unknown.test');
  });
});

describe('autonomy policy', () => {
  it('full mode is silent except genuinely destructive actions', () => {
    const full = policyForAutonomyMode('full');
    expect(full.external_write).toBe('auto');
    expect(full.external_send).toBe('auto');
    expect(full.credential_access).toBe('auto');
    expect(full.process_exec).toBe('auto');
    expect(full.destructive).toBe('ask');
  });

  it('semi asks on write/send/credential; manual asks on everything', () => {
    const semi = policyForAutonomyMode('semi');
    expect(semi.external_write).toBe('ask');
    expect(semi.credential_access).toBe('ask');
    expect(semi.read_only).toBe('auto');
    const manual = policyForAutonomyMode('manual');
    expect(manual.read_only).toBe('ask');
    expect(manual.external_write).toBe('ask');
  });
});

describe('tauriFetch', () => {
  it('falls back to global fetch outside Tauri', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'hello' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await tauriFetch('https://x.test', { method: 'POST', body: 'b' });
    expect(fetchMock).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    vi.unstubAllGlobals();
  });
});
