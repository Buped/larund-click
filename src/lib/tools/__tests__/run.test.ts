import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { runControlAction } from '../run';
import { MemoryAuditLogger, sanitizeArgs } from '../audit';
import { AutoApprovalService, PromptApprovalService } from '../approvals';
import type { ToolContext } from '../types';
import type { SkillRuntimeContext } from '../../skills/types';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'u', sessionId: 's', workspaceRoot: '~', task: 't',
    audit: new MemoryAuditLogger(), approvals: new AutoApprovalService(),
    ...overrides,
  };
}

function skill(name: string, allowedTools: string[]): SkillRuntimeContext {
  return {
    skillId: `bundled:${name}`, name, version: '1.0.0', body: '', allowedTools,
    requiredConnections: [], requiredMcpServers: [], risk: 'read_only',
    verificationChecklist: [], references: [], templates: [], missingRequirements: [],
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

  it('lets the agent move local files even when only read-only skills are active', async () => {
    // Regression: a read-only skill (e.g. task-verification) being active must not
    // block core local file ops like file.move — moving files is a core capability.
    invokeMock.mockResolvedValue('Moved');
    const active = [skill('task-verification', ['file.read', 'sheet.read'])];
    const res = await runControlAction(
      { action: 'file.move', from: 'a/x.pdf', to: 'b/x.pdf' },
      ctx({ activeSkills: active }),
    );
    expect(res.success).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('still scopes non-core tools to the active skills', async () => {
    // External/process tools are NOT in the core baseline, so an unrelated active
    // skill that does not list them keeps blocking them.
    const active = [skill('task-verification', ['file.read'])];
    const res = await runControlAction(
      { action: 'browser.click', target: 'Save' },
      ctx({ activeSkills: active }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/blocked_by_active_skill_allowed_tools/);
  });

  it('redacts secrets from audit args', () => {
    const summary = sanitizeArgs({ action: 'connection.call', args: { token: 'ghp_abcdefghijklmnopqrstuvwxyz012345' } });
    expect(summary).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
    expect(summary).toContain('redacted');
  });
});
