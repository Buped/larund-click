import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { executeV2 } from '../executor';
import { validateActionPlan } from '../plan-schema';
import { classifyRisk } from '../safety';
import type { ScreenState, ActionPlan } from '../types';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
function state(): ScreenState {
  return {
    screenshot_width: 1920, screenshot_height: 1080, screen_width: 1920, screen_height: 1080,
    dpi_scale: 1, active_window_title: 'Test', active_app_name: 'test', elements: [],
    timestamp: new Date().toISOString(),
  };
}
beforeEach(() => { invokeMock.mockReset(); });

describe('plan-schema hybrid actions', () => {
  it('accepts cli_command with a command (and the cmd alias)', () => {
    expect(validateActionPlan({ action: 'cli_command', command: 'code .', reason: 'open', confidence: 1 }).ok).toBe(true);
    const aliased = validateActionPlan({ action: 'cli_command', cmd: 'npm run build', reason: 'x', confidence: 1 });
    expect(aliased.ok).toBe(true);
    if (aliased.ok) expect(aliased.plan.command).toBe('npm run build');
  });
  it('rejects cli_command without a command', () => {
    expect(validateActionPlan({ action: 'cli_command', reason: 'x', confidence: 1 }).ok).toBe(false);
  });
  it('accepts browser_open with a url', () => {
    expect(validateActionPlan({ action: 'browser_open', url: 'https://x.com', reason: 'x', confidence: 1 }).ok).toBe(true);
    expect(validateActionPlan({ action: 'browser_open', reason: 'x', confidence: 1 }).ok).toBe(false);
  });
});

describe('executeV2 — CLI + browser routing in the same executor', () => {
  it('cli_command → shell_run, returns the CLI observation', async () => {
    invokeMock.mockResolvedValue({ stdout: 'ok out', stderr: '', exit_code: 0, success: true });
    const plan: ActionPlan = { action: 'cli_command', command: 'start chrome https://example.com', reason: 'open chrome', confidence: 0.9 };
    const r = await executeV2(plan, state());
    expect(invokeMock).toHaveBeenCalledWith('shell_run', { command: 'start chrome https://example.com', workingDir: null });
    expect(r.used_method).toBe('cli');
    expect(r.success).toBe(true);
    expect(r.cli?.stdout).toBe('ok out');
    expect(r.cli?.exitCode).toBe(0);
  });

  it('cli_command failure surfaces stderr + exit code', async () => {
    invokeMock.mockResolvedValue({ stdout: '', stderr: 'boom', exit_code: 1, success: false });
    const r = await executeV2({ action: 'cli_command', command: 'badcmd', reason: 'x', confidence: 1 }, state());
    expect(r.success).toBe(false);
    expect(r.error).toContain('boom');
    expect(r.cli?.exitCode).toBe(1);
  });

  it('browser_open → CDP browser_open (so DOM actions work next)', async () => {
    invokeMock.mockResolvedValue('Opened https://x.com');
    const r = await executeV2({ action: 'browser_open', url: 'https://x.com', reason: 'web', confidence: 1 }, state());
    expect(invokeMock).toHaveBeenCalledWith('browser_open', { url: 'https://x.com' });
    expect(r.used_method).toBe('browser');
  });
});

describe('safety gate covers destructive CLI', () => {
  it('flags rm -rf / git push --force / format as high risk', () => {
    expect(classifyRisk({ action: 'cli_command', command: 'rm -rf /important', reason: 'x', confidence: 1 }).level).toBe('high');
    expect(classifyRisk({ action: 'cli_command', command: 'git push --force origin main', reason: 'x', confidence: 1 }).level).toBe('high');
    expect(classifyRisk({ action: 'cli_command', command: 'format D:', reason: 'x', confidence: 1 }).level).toBe('high');
  });
  it('allows ordinary CLI commands', () => {
    expect(classifyRisk({ action: 'cli_command', command: 'npm run build', reason: 'build', confidence: 1 }).level).toBe('low');
    expect(classifyRisk({ action: 'cli_command', command: 'code .', reason: 'open vscode', confidence: 1 }).level).toBe('low');
    expect(classifyRisk({ action: 'cli_command', command: 'git status', reason: 'check', confidence: 1 }).level).toBe('low');
  });
});
