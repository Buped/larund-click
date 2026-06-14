import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStep } from '../loop';

const invokeMock = vi.fn();
const openRouterMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('../../openrouter', () => ({
  callOpenRouterWithTools: openRouterMock,
}));
vi.mock('../../supabase', () => ({
  supabase: { rpc: rpcMock },
}));

describe('control-system loop', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openRouterMock.mockReset();
    rpcMock.mockReset();
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
});
