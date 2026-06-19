import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
const http = invoke as unknown as ReturnType<typeof vi.fn>;

import { createConnectionRegistry } from '../../../registry';
import { connectApiKeyProvider, disconnectApiKeyProvider } from '../../../userCredentials';
import { resolveRuntimeCredentials } from '../../../runtimeCredentials';
import { __resetConnectedAccountsForTests, getConnectedAccount } from '../../../connectedAccounts';
import { assessRisk, decide } from '../../../../tools/policy';
import type { ControlAction } from '../../../../control-system/types';

const PASSWORD = 'super secret app pw 1234';

function callAction(tool: string): ControlAction {
  return { action: 'connection.call', connection: 'wordpress', tool, args: {} } as ControlAction;
}

function mockWordPress() {
  http.mockImplementation((cmd: string, args: { method: string; url: string; body?: string }) => {
    if (cmd !== 'http_request') throw new Error(`unexpected command ${cmd}`);
    const { method, url, body } = args;
    if (url.endsWith('/wp/v2/users/me?context=edit')) {
      return { status: 200, body: JSON.stringify({ name: 'Admin', capabilities: { publish_posts: true } }) };
    }
    if (url.endsWith('/wp-json')) {
      return { status: 200, body: JSON.stringify({ name: 'Demo Site', description: 'Mock', url: 'https://demo.tld' }) };
    }
    if (method === 'POST' && url.endsWith('/wp/v2/posts')) {
      const b = JSON.parse(body ?? '{}');
      return { status: 201, body: JSON.stringify({ id: 42, link: 'https://demo.tld/?p=42', status: b.status, title: { rendered: b.title } }) };
    }
    if (method === 'POST' && /\/wp\/v2\/posts\/42$/.test(url)) {
      const b = JSON.parse(body ?? '{}');
      return { status: 200, body: JSON.stringify({ id: 42, status: b.status ?? 'draft', link: 'https://demo.tld/?p=42', title: { rendered: 'Hello' } }) };
    }
    if (method === 'GET' && /\/wp\/v2\/posts\/42/.test(url)) {
      return { status: 200, body: JSON.stringify({ id: 42, status: 'draft', link: 'https://demo.tld/?p=42', title: { rendered: 'Hello' } }) };
    }
    if (method === 'GET' && /\/wp\/v2\/posts\?/.test(url)) {
      return { status: 200, body: JSON.stringify([{ id: 1, status: 'publish', title: { rendered: 'A' } }, { id: 2, status: 'draft', title: { rendered: 'B' } }]) };
    }
    return { status: 404, body: JSON.stringify({ message: 'not found' }) };
  });
}

async function connect() {
  await connectApiKeyProvider({
    providerId: 'wordpress',
    accountLabel: 'demo.tld',
    fields: { WORDPRESS_SITE_URL: 'https://demo.tld', WORDPRESS_USERNAME: 'admin', WORDPRESS_APP_PASSWORD: PASSWORD },
  });
}

describe('WordPress connection', () => {
  beforeEach(() => {
    __resetConnectedAccountsForTests();
    http.mockReset();
    mockWordPress();
  });

  it('stores the app password in the secret store, never on the account record', async () => {
    await connect();
    const account = getConnectedAccount('wordpress');
    expect(account?.status).toBe('connected');
    expect(account?.authType).toBe('api_key');
    // The record carries only field NAMES, never the value.
    expect(JSON.stringify(account)).not.toContain(PASSWORD);
    expect((account?.metadata?.credentialFields as string[])).toContain('WORDPRESS_APP_PASSWORD');
  });

  it('surfaces the credential fields to tool runtime, not the prompt/UI', async () => {
    await connect();
    const resolved = await resolveRuntimeCredentials('wordpress');
    expect(resolved.ok).toBe(true);
    expect(resolved.secrets.WORDPRESS_SITE_URL).toBe('https://demo.tld');
    expect(resolved.secrets.WORDPRESS_APP_PASSWORD).toBe(PASSWORD);
  });

  it('blocks tool calls when not connected (no mock success)', async () => {
    const reg = createConnectionRegistry('local');
    const r = await reg.call('wordpress', 'wordpress.list_posts', {});
    expect(r.success).toBe(false);
  });

  it('test_connection verifies the site + user', async () => {
    await connect();
    const reg = createConnectionRegistry('local');
    const r = await reg.call('wordpress', 'wordpress.test_connection', {});
    expect(r.success).toBe(true);
    expect(r.output).toContain('Connected to WordPress as Admin');
  });

  it('create_draft creates a DRAFT and never publishes', async () => {
    await connect();
    const reg = createConnectionRegistry('local');
    const r = await reg.call('wordpress', 'wordpress.create_draft', { title: 'Hello', content: 'Body' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('#42');
    expect((r.details as { status?: string })?.status).toBe('draft');
  });

  it('update_post refuses to silently publish', async () => {
    await connect();
    const reg = createConnectionRegistry('local');
    const r = await reg.call('wordpress', 'wordpress.update_post', { id: 42, status: 'publish' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('use_publish_tool');
  });

  it('publish verifies the published status', async () => {
    await connect();
    const reg = createConnectionRegistry('local');
    const r = await reg.call('wordpress', 'wordpress.publish_post_with_approval', { id: 42 });
    expect(r.success).toBe(true);
    expect(r.output).toContain('Published');
  });

  it('gates approval by the manifest-declared risk', () => {
    expect(assessRisk(callAction('wordpress.list_posts'))).toBe('external_read');
    expect(assessRisk(callAction('wordpress.create_draft'))).toBe('external_write');
    expect(assessRisk(callAction('wordpress.update_post'))).toBe('external_write');
    expect(assessRisk(callAction('wordpress.set_featured_media'))).toBe('external_write');
    expect(assessRisk(callAction('wordpress.publish_post_with_approval'))).toBe('external_send');
    // Writes/publish must require approval under the default policy; reads auto-run.
    expect(decide(callAction('wordpress.create_draft')).decision).toBe('ask');
    expect(decide(callAction('wordpress.publish_post_with_approval')).decision).toBe('ask');
    expect(decide(callAction('wordpress.list_posts')).decision).toBe('auto');
  });

  it('disconnect wipes the stored credentials', async () => {
    await connect();
    await disconnectApiKeyProvider('wordpress');
    expect(getConnectedAccount('wordpress')).toBeUndefined();
    const resolved = await resolveRuntimeCredentials('wordpress');
    expect(resolved.ok).toBe(false);
  });
});
