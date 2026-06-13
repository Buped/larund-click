import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// Controllable fake model: each call shifts the next response off the queue.
const h = vi.hoisted(() => ({ responses: [] as string[] }));
vi.mock('../../openrouter', () => ({
  callOpenRouterWithTools: vi.fn(
    async (
      _messages: unknown, _model: string, _user: string,
      onChunk: (c: string) => void,
      onComplete: (u: { costUsd: number }) => void,
    ) => {
      onChunk(h.responses.shift() ?? '');
      onComplete({ costUsd: 0 });
    },
  ),
}));

import { planV2, extractJsonObject } from '../planner';
import { callOpenRouterWithTools } from '../../openrouter';
import type { ScreenState } from '../types';

const callMock = callOpenRouterWithTools as unknown as ReturnType<typeof vi.fn>;

function ctx(state: ScreenState) {
  return { goal: 'open VS Code Extensions', state, modelId: 'm', userId: 'u', addCost: () => {} };
}
function vscodeState(): ScreenState {
  return {
    screenshot_width: 1920, screenshot_height: 1080, screen_width: 1920, screen_height: 1080,
    dpi_scale: 1, active_window_title: 'proj - Visual Studio Code', active_app_name: 'Code',
    elements: [], timestamp: new Date().toISOString(),
  };
}

beforeEach(() => { h.responses = []; callMock.mockClear(); });

describe('extractJsonObject', () => {
  it('extracts a balanced object ignoring surrounding prose', () => {
    const j = extractJsonObject('thinking... {"action":"done","summary":"ok {nested}"} trailing');
    expect(j).toBe('{"action":"done","summary":"ok {nested}"}');
  });
});

describe('planV2', () => {
  it('returns a validated plan (hotkey for VS Code Extensions)', async () => {
    h.responses = ['{"action":"hotkey","keys":["ctrl","shift","x"],"reason":"open extensions","confidence":0.95,"expect":{"type":"panel_opened","value":"Extensions"}}'];
    const res = await planV2(ctx(vscodeState()));
    expect(res.kind).toBe('plan');
    if (res.kind === 'plan') {
      expect(res.plan.action).toBe('hotkey');
      expect(res.plan.keys).toEqual(['ctrl', 'shift', 'x']);
    }
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it('repairs after one invalid response', async () => {
    h.responses = [
      'no json here at all',
      '{"action":"click_element","target":{"element_id":"e_1"},"reason":"x","confidence":0.8}',
    ];
    const res = await planV2(ctx(vscodeState()));
    expect(res.kind).toBe('plan');
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to legacy after two bad responses', async () => {
    h.responses = ['garbage', 'still garbage'];
    const res = await planV2(ctx(vscodeState()));
    expect(res.kind).toBe('fallback');
    expect(callMock).toHaveBeenCalledTimes(2);
  });
});
