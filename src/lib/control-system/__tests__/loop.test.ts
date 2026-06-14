import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStep } from '../loop';

const invokeMock = vi.fn();
const openRouterMock = vi.fn();
const rpcMock = vi.fn();
const runSocLoopMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('../../openrouter', () => ({
  callOpenRouterWithTools: openRouterMock,
}));
vi.mock('../../supabase', () => ({
  supabase: { rpc: rpcMock },
}));
vi.mock('../../soc-mode/run-soc-turn', () => ({
  runSocLoop: runSocLoopMock,
}));

describe('control-system loop', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openRouterMock.mockReset();
    rpcMock.mockReset();
    runSocLoopMock.mockReset();
  });

  it('does not gate task.complete on a visual action (CLI-first)', async () => {
    // Even when the task mentions clicking/mouse, the agent may finish purely
    // via deterministic actions — completion must not require a visual action.
    openRouterMock.mockImplementation(async (_messages, _model, _user, onChunk) => {
      onChunk('{"action":"task.complete","summary":"Done via CLI"}');
    });
    invokeMock.mockResolvedValue(undefined);

    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const onComplete = vi.fn();
    const onError = vi.fn();
    await runControlLoop('Nyisd meg a Robloxot es kattints a Ground War jatekra egerrel.', 'model', 'user', {
      onStatus: vi.fn(),
      onStep: (step) => { steps.push(step); },
      onAskUser: vi.fn(async () => 'stop'),
      onComplete,
      onError,
    }, { aborted: false });

    expect(steps.some((step) => step.error === 'completion_blocked_visual_not_verified')).toBe(false);
    expect(onComplete).toHaveBeenCalledWith('Done via CLI');
    expect(onError).not.toHaveBeenCalled();
  });

  it('blocks legacy raw mouse tools before execution', async () => {
    openRouterMock
      .mockImplementationOnce(async (_messages, _model, _user, onChunk) => {
        onChunk('{"tool":"mouse_click","x":100,"y":200}');
      })
      .mockImplementationOnce(async (_messages, _model, _user, onChunk) => {
        onChunk('{"action":"task.complete","summary":"Stopped after raw mouse rejection"}');
      });
    invokeMock.mockResolvedValue(undefined);

    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    await runControlLoop('Click with a raw mouse tool', 'model', 'user', {
      onStatus: vi.fn(),
      onStep: (step) => { steps.push(step); },
      onAskUser: vi.fn(async () => 'stop'),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }, { aborted: false });

    expect(steps).toContainEqual(expect.objectContaining({
      type: 'error',
      tool: 'mouse_click',
      error: 'raw_mouse_tool_not_available',
    }));
    expect(invokeMock).not.toHaveBeenCalledWith('mouse_click', expect.anything());
  });

  it('runs mandatory SOC visual after GUI app launch', async () => {
    openRouterMock.mockImplementation(async (_messages, _model, _user, onChunk) => {
      onChunk('{"action":"app.open","name":"Roblox"}');
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === 'desktop_open_app') return '{"opened":true,"app":"Roblox"}';
      return undefined;
    });
    runSocLoopMock.mockResolvedValue({
      success: true,
      summary: 'Roblox game screen visible',
      history: [],
      debugDir: '~/.larund-click/soc-mode/test-run',
      screenshot: { base64: 'after', width: 1920, height: 1080 },
    });

    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const onComplete = vi.fn();
    await runControlLoop('Nyisd meg a Robloxot, majd SOC vizualis moddal lepj be a legutobb jatszott jatekba.', 'model', 'user', {
      onStatus: vi.fn(),
      onStep: (step) => { steps.push(step); },
      onAskUser: vi.fn(async () => 'stop'),
      onComplete,
      onError: vi.fn(),
    }, { aborted: false });

    expect(runSocLoopMock).toHaveBeenCalledWith(
      'Nyisd meg a Robloxot, majd SOC vizualis moddal lepj be a legutobb jatszott jatekba.',
      'user',
      expect.objectContaining({ addCost: expect.any(Function) }),
    );
    expect(steps).toContainEqual(expect.objectContaining({
      type: 'tool_call',
      tool: 'soc.visual',
      details: expect.objectContaining({ reason: 'mandatory_after_gui_app_launch' }),
    }));
    expect(onComplete).toHaveBeenCalledWith(expect.stringContaining('soc_visual_complete'));
  });
});
