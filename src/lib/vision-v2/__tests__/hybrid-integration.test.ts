import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// Fake model: queued responses + records the messages it was called with, so we
// can assert the planner actually SAW the CLI output / retry context.
const h = vi.hoisted(() => ({ responses: [] as string[], calls: [] as unknown[][] }));
vi.mock('../../openrouter', () => ({
  callOpenRouterWithTools: vi.fn(
    async (messages: unknown[], _id: string, _u: string, onChunk: (c: string) => void, onComplete: (u: { costUsd: number }) => void) => {
      h.calls.push(messages);
      onChunk(h.responses.shift() ?? '');
      onComplete({ costUsd: 0 });
    },
  ),
}));

import { invoke } from '@tauri-apps/api/core';
import { runVisionV2Turn, newV2Memory, type V2TurnContext, type V2Memory } from '../run-v2';
import type { AgentStep } from '../agent-loop';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

let chromeOpen = false;

function dispatcher(cmd: string): unknown {
  switch (cmd) {
    case 'take_screenshot': return { base64: 'AAAA', width: 1920, height: 1080, monitor_id: 0 };
    case 'get_screen_size': return [1920, 1080];
    case 'shell_run': chromeOpen = true; return { stdout: '', stderr: '', exit_code: 0, success: true };
    case 'browser_probe': return chromeOpen;
    case 'browser_read': return 'URL: https://example.com\nTITLE: Example\nCLICKABLE/INPUTS:\nbutton: Submit\n';
    case 'browser_click': return 'CLICKED BUTTON';
    case 'desktop_visual_locate': return JSON.stringify({ candidate_points: [], confidence: 0, reason: 'none' });
    case 'desktop_read':
      return JSON.stringify({
        window: { title: chromeOpen ? 'Example - Google Chrome' : 'Desktop', process_name: 'chrome', bounds: { x: 0, y: 0, width: 1920, height: 1040 } },
        snapshot_token: 't', targets: [],
      });
    default: return 'ok';
  }
}

function makeCtx(mem: V2Memory, steps: AgentStep[]): V2TurnContext {
  return {
    task: 'open example.com then click the visible button',
    modelId: 'm', userId: 'u', webHint: false, autonomyMode: 'semi', mem,
    addCost: () => {},
    emitStep: (s) => steps.push(s),
    ensureScreenClear: async () => {},
    restoreForUser: async () => {},
    guardSetBlock: async () => {},
    isAborted: async () => false,
    onAskUser: async () => 'yes',
  };
}

/** Extract the planner's user text from a recorded call. */
function userText(call: unknown[]): string {
  const msgs = call as { role: string; content: unknown }[];
  const user = msgs.find((m) => m.role === 'user');
  if (!user) return '';
  if (typeof user.content === 'string') return user.content;
  const parts = user.content as { type: string; text?: string }[];
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

beforeEach(() => {
  h.responses = []; h.calls = []; chromeOpen = false;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => Promise.resolve(dispatcher(cmd)));
});

describe('hybrid: CLI then visual in ONE loop', () => {
  it('turn 1 runs cli_command (opens Chrome); turn 2 observes + clicks via DOM', async () => {
    const mem = newV2Memory();
    const steps: AgentStep[] = [];

    // Turn 1: CLI opens Chrome.
    h.responses = [JSON.stringify({
      action: 'cli_command', command: 'start chrome https://example.com',
      reason: 'open chrome via CLI', confidence: 0.9, expect: { type: 'window_changed', timeout_ms: 10 },
    })];
    const r1 = await runVisionV2Turn(makeCtx(mem, steps));
    expect(r1.kind).toBe('continue');
    expect(invokeMock).toHaveBeenCalledWith('shell_run', { command: 'start chrome https://example.com', workingDir: null });
    expect(mem.lastCli?.exitCode).toBe(0);

    // Turn 2: planner now sees the DOM (Submit button) and the CLI output.
    h.responses = [JSON.stringify({
      action: 'click_element', target: { element_id: 'dom_0' },
      reason: 'Chrome open, Submit visible', confidence: 0.9, expect: { type: 'text_appears', value: 'Example', timeout_ms: 10 },
    })];
    const r2 = await runVisionV2Turn(makeCtx(mem, steps));
    expect(r2.kind).toBe('continue');
    expect(invokeMock).toHaveBeenCalledWith('browser_click', { target: 'Submit' });

    // The planner on turn 2 saw BOTH the previous CLI output and the screen.
    const t2 = userText(h.calls[1]);
    expect(t2).toContain('PREVIOUS CLI OUTPUT');
    expect(t2).toContain('dom_0'); // DOM element from the auto-activated provider
    // Did NOT stay CLI-locked: turn 2 used a DOM/browser action.
    const resultSteps = steps.filter((s) => s.tool === 'v2:click_element');
    expect(resultSteps.length).toBeGreaterThan(0);
  });

  it('failed visual action feeds a RETRY CONTEXT into the next planner step', async () => {
    const mem = newV2Memory();
    const steps: AgentStep[] = [];
    h.responses = [JSON.stringify({
      action: 'click_text', target: { text: 'Nonexistent' },
      reason: 'try clicking', confidence: 0.6, expect: { type: 'text_appears', value: 'Nonexistent', required: true, timeout_ms: 10 },
    })];
    await runVisionV2Turn(makeCtx(mem, steps));
    expect(mem.retryContext).toBeTruthy();

    h.responses = [JSON.stringify({ action: 'cli_command', command: 'echo retry', reason: 'switch modality', confidence: 0.8 })];
    await runVisionV2Turn(makeCtx(mem, steps));
    const t2 = userText(h.calls[1]);
    expect(t2).toContain('RETRY CONTEXT');
  });
});
