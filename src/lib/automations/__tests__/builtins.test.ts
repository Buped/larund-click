import { beforeEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../coworker/persistence';
import { getAutomation, listAutomations, updateAutomation } from '../store';
import { ensureBuiltInAutomations, BUILT_IN_AUTOMATION_DEFINITIONS, BUILT_IN_AUTOMATION_VERSION } from '../builtins';
import { normalizeAutomation } from '../migrate';
import { renderAutomationPrompt } from '../runner';
import { stopAllAutomationTimers } from '../scheduler';

beforeEach(() => {
  stopAllAutomationTimers();
  resetRecordBackendForTests();
});

describe('built-in automations', () => {
  it('creates exactly the built-in automations for a user/workspace', async () => {
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });

    const automations = await listAutomations({ userId: 'u1', workspaceId: 'ws1', includeDisabled: true });

    expect(automations).toHaveLength(BUILT_IN_AUTOMATION_DEFINITIONS.length);
    expect(automations).toHaveLength(9);
    expect(automations.every((automation) => automation.enabled === false)).toBe(true);
    expect(automations.every((automation) => automation.status === 'disabled')).toBe(true);
    expect(automations.every((automation) => automation.chatMode === 'none')).toBe(true);
    expect(automations.every((automation) => automation.metadata?.isBuiltIn === true)).toBe(true);
    expect(automations.every((automation) => automation.metadata?.builtInVersion === BUILT_IN_AUTOMATION_VERSION)).toBe(true);
  });

  it('is idempotent and does not duplicate built-ins', async () => {
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });

    const automations = await listAutomations({ userId: 'u1', workspaceId: 'ws1', includeDisabled: true });
    const packIds = automations.map((automation) => automation.metadata?.builtInPackId);

    expect(automations).toHaveLength(9);
    expect(new Set(packIds).size).toBe(9);
  });

  it('does not overwrite a user-customized built-in automation', async () => {
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });
    const [automation] = await listAutomations({ userId: 'u1', workspaceId: 'ws1', includeDisabled: true });
    await updateAutomation(automation.id, {
      name: 'My custom automation',
      prompt: 'custom prompt',
      metadata: { ...automation.metadata, userCustomized: true },
    });

    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });
    const updated = await getAutomation(automation.id);

    expect(updated?.name).toBe('My custom automation');
    expect(updated?.prompt).toBe('custom prompt');
    expect(updated?.metadata?.userCustomized).toBe(true);
  });

  it('creates runnable workflow definitions with steps, verification, safety, and metadata', async () => {
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });
    const automations = await listAutomations({ userId: 'u1', workspaceId: 'ws1', includeDisabled: true });

    for (const automation of automations) {
      const normalized = normalizeAutomation(automation);
      expect(normalized.steps.length).toBeGreaterThan(0);
      expect(normalized.verificationChecklist.length).toBeGreaterThan(0);
      expect(normalized.safetyPolicy.externalSend).toBe('ask');
      expect(normalized.safetyPolicy.destructive).toBe('ask_strong');
      expect(normalized.metadata?.builtInPackId).toBeTruthy();
    }
  });

  it('renders built-in prompts with ordered steps and verification checks', async () => {
    await ensureBuiltInAutomations({ userId: 'u1', workspaceId: 'ws1' });
    const automations = await listAutomations({ userId: 'u1', workspaceId: 'ws1', includeDisabled: true });
    const email = normalizeAutomation(automations.find((automation) => automation.metadata?.builtInPackId === 'email-triage-reply-drafts')!);

    const prompt = renderAutomationPrompt(email, { reason: 'test_run' });

    expect(prompt).toContain('Follow these steps in order');
    expect(prompt).toContain('Search inbox');
    expect(prompt).toContain('Verification');
    expect(prompt).toContain('No email was sent without approval');
  });
});
