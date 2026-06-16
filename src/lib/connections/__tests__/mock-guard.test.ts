import { describe, expect, it, afterEach } from 'vitest';
import { mockConnectionsAllowed, missingAuth, mockOrMissingAuth } from '../mock-guard';

type MockGlobal = { LARUND_ALLOW_MOCK_CONNECTIONS?: unknown };

describe('connection mock guard', () => {
  afterEach(() => { delete (globalThis as MockGlobal).LARUND_ALLOW_MOCK_CONNECTIONS; });

  it('disallows mocks by default (production safety)', () => {
    expect(mockConnectionsAllowed()).toBe(false);
  });

  it('allows mocks only when explicitly enabled', () => {
    (globalThis as MockGlobal).LARUND_ALLOW_MOCK_CONNECTIONS = true;
    expect(mockConnectionsAllowed()).toBe(true);
  });

  it('missingAuth returns a structured, actionable, secret-free failure', () => {
    const r = missingAuth('GitHub', 'github.read_file', 'Add a token.');
    expect(r.success).toBe(false);
    expect(r.error).toContain('missing_auth');
    expect(r.error).toContain('GitHub');
    expect(r.details?.missingAuth).toBe(true);
  });

  it('mockOrMissingAuth returns missing_auth in production, mock when allowed', () => {
    const prod = mockOrMissingAuth('Notion', 'notion.search', 'notion.search "x"');
    expect(prod.success).toBe(false);
    expect(prod.error).toContain('missing_auth');

    (globalThis as MockGlobal).LARUND_ALLOW_MOCK_CONNECTIONS = true;
    const dev = mockOrMissingAuth('Notion', 'notion.search', 'notion.search "x"');
    expect(dev.success).toBe(true);
    expect(dev.output).toContain('[mock]');
    expect(dev.details?.mock).toBe(true);
  });
});
