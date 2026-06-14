import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { runControlAction } from '../run';
import { MemoryAuditLogger, sanitizeArgs } from '../audit';
import { AutoApprovalService, PromptApprovalService } from '../approvals';
import type { ToolContext } from '../types';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'u', sessionId: 's', workspaceRoot: '~', task: 't',
    audit: new MemoryAuditLogger(), approvals: new AutoApprovalService(),
    ...overrides,
  };
}

describe('guarded runControlAction', () => {
  beforeEach(() => invokeMock.mockReset());

  it('runs a read-only action and audits it', async () => {
    invokeMock.mockResolvedValue('file body');
    const audit = new MemoryAuditLogger();
    const res = await runControlAction({ action: 'file.read', path: 'a.txt' }, ctx({ audit }));
    expect(res.success).toBe(true);
    expect(audit.list()).toHaveLength(1);
    expect(audit.list()[0].risk).toBe('read_only');
  });

  it('requires approval for a destructive action and denies it', async () => {
    const approvals = new PromptApprovalService(undefined, 'deny');
    const res = await runControlAction({ action: 'file.delete', path: 'a.txt' }, ctx({ approvals }));
    expect(res.success).toBe(false);
    expect(res.error).toBe('approval_denied');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('runs a destructive action once approved', async () => {
    invokeMock.mockResolvedValue('Deleted');
    const approvals = new PromptApprovalService(async () => 'allow_once');
    const res = await runControlAction({ action: 'file.delete', path: 'a.txt', recursive: true }, ctx({ approvals }));
    expect(res.success).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('fs_delete', { path: 'a.txt', recursive: true });
  });

  it('redacts secrets from audit args', () => {
    const summary = sanitizeArgs({ action: 'connection.call', args: { token: 'ghp_abcdefghijklmnopqrstuvwxyz012345' } });
    expect(summary).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
    expect(summary).toContain('redacted');
  });
});
