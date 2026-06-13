import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const h = vi.hoisted(() => ({ responses: [] as string[] }));
vi.mock('../../openrouter', () => ({
  callOpenRouterWithTools: vi.fn(
    async (_m: unknown, _id: string, _u: string, onChunk: (c: string) => void, onComplete: (u: { costUsd: number }) => void) => {
      onChunk(h.responses.shift() ?? '');
      onComplete({ costUsd: 0 });
    },
  ),
}));

import { invoke } from '@tauri-apps/api/core';
import { runVisionV2Turn, newV2Memory, type V2TurnContext } from '../run-v2';
import type { AgentStep } from '../agent-loop';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

const VSCODE_SNAPSHOT = JSON.stringify({
  window: { title: 'proj - Visual Studio Code', process_name: 'Code', bounds: { x: 0, y: 0, width: 1920, height: 1040 } },
  snapshot_token: 'tok',
  targets: [
    { id: 'fg|x', name: 'Extensions', role: 'Button', automation_id: null, bounds: { x: 10, y: 200, width: 40, height: 40 },
      enabled: true, visible: true, focused: false, window_title: 'proj - Visual Studio Code', can_invoke: true, can_scroll: false, is_keyboard_focusable: true },
  ],
});

function dispatcher(cmd: string): unknown {
  switch (cmd) {
    case 'take_screenshot': return { base64: 'AAAA', width: 1920, height: 1080, monitor_id: 0 };
    case 'get_screen_size': return [1920, 1080];
    case 'browser_probe': return false;
    case 'desktop_read': return VSCODE_SNAPSHOT;
    default: return 'ok';
  }
}

function makeCtx(steps: AgentStep[]): V2TurnContext {
  return {
    task: 'open VS Code Extensions panel',
    modelId: 'm', userId: 'u', webHint: false, autonomyMode: 'semi',
    mem: newV2Memory(),
    addCost: () => {},
    emitStep: (s) => steps.push(s),
    ensureScreenClear: async () => {},
    restoreForUser: async () => {},
    guardSetBlock: async () => {},
    isAborted: async () => false,
    onAskUser: async () => 'yes',
  };
}

beforeEach(() => {
  h.responses = [];
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => Promise.resolve(dispatcher(cmd)));
});

describe('runVisionV2Turn integration', () => {
  it('open VS Code Extensions → emits a hotkey plan and fires Ctrl+Shift+X', async () => {
    h.responses = [
      JSON.stringify({
        action: 'hotkey', keys: ['ctrl', 'shift', 'x'], reason: 'open extensions',
        confidence: 0.95, expect: { type: 'panel_opened', value: 'Extensions', timeout_ms: 10 },
      }),
    ];
    const steps: AgentStep[] = [];
    const res = await runVisionV2Turn(makeCtx(steps));
    expect(res.kind).toBe('continue');
    expect(invokeMock).toHaveBeenCalledWith('key_combo', { keys: ['ctrl', 'shift', 'x'] });
    // a tool_call step tagged as v2 was emitted
    expect(steps.some((s) => s.tool === 'v2:hotkey')).toBe(true);
  });

  it('done plan → completes the task', async () => {
    h.responses = [JSON.stringify({ action: 'done', summary: 'finished', reason: 'goal met', confidence: 1 })];
    const steps: AgentStep[] = [];
    const res = await runVisionV2Turn(makeCtx(steps));
    expect(res.kind).toBe('complete');
    if (res.kind === 'complete') expect(res.summary).toBe('finished');
  });

  it('planner fallback → signals legacy fallback', async () => {
    h.responses = ['not json', 'still not json'];
    const steps: AgentStep[] = [];
    const res = await runVisionV2Turn(makeCtx(steps));
    expect(res.kind).toBe('fallback_legacy');
  });

  it('risky action → asks the user instead of auto-clicking', async () => {
    h.responses = [
      JSON.stringify({ action: 'click_text', target: { text: 'Delete account' }, reason: 'remove', confidence: 0.9 }),
    ];
    const steps: AgentStep[] = [];
    const ctx = makeCtx(steps);
    const asked: string[] = [];
    ctx.onAskUser = async (q) => { asked.push(q); return 'no'; };
    const res = await runVisionV2Turn(ctx);
    expect(asked.length).toBe(1);
    expect(res.kind).toBe('continue');
    // declined → no mouse_click happened
    expect(invokeMock).not.toHaveBeenCalledWith('mouse_click', expect.anything());
  });
});
