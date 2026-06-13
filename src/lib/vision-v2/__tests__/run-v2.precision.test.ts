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

// Roblox-like UI: a big container ("Recently Played", role List/Pane, visual_refine,
// low precision) and — only visible via a REGION precision read — a smaller game card.
const ROBLOX_CONTAINER = {
  window: { title: 'Roblox', process_name: 'RobloxPlayerBeta', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  snapshot_token: 'tok-sem',
  targets: [
    {
      id: 'fg|home', name: 'Recently Played', role: 'List', automation_id: null,
      bounds: { x: 400, y: 200, width: 560, height: 420 },
      enabled: true, visible: true, focused: false, window_title: 'Roblox',
      can_invoke: false, can_scroll: true, is_keyboard_focusable: true,
      children_count: 12, precision_level: 'low', target_confidence: 0.4,
      click_strategy: 'visual_refine', is_large_container: true,
    },
  ],
};

const ROBLOX_REGION = {
  window: { title: 'Roblox', process_name: 'RobloxPlayerBeta', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  snapshot_token: 'tok-region',
  targets: [
    {
      id: 'fg|card', name: 'Recently Played Game', role: 'ListItem', automation_id: 'card1',
      bounds: { x: 420, y: 240, width: 190, height: 110 },
      enabled: true, visible: true, focused: false, window_title: 'Roblox',
      can_invoke: true, can_scroll: false, is_keyboard_focusable: true,
      children_count: 0, precision_level: 'high', target_confidence: 0.8,
      click_strategy: 'invoke', is_large_container: false,
    },
  ],
};

function makeCtx(steps: AgentStep[]): V2TurnContext {
  return {
    task: 'open Roblox and click the most recently played game',
    modelId: 'm', userId: 'u', webHint: false, autonomyMode: 'semi',
    mem: newV2Memory(),
    addCost: () => {}, emitStep: (s) => steps.push(s),
    ensureScreenClear: async () => {}, restoreForUser: async () => {},
    guardSetBlock: async () => {}, isAborted: async () => false,
    onAskUser: async () => 'yes',
  };
}

beforeEach(() => {
  h.responses = [];
  invokeMock.mockReset();
});

describe('Precision V3 — pre-click refine on a large container', () => {
  it('does NOT click the container center; refines to the smaller child point', () => {
    return (async () => {
      invokeMock.mockImplementation((cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd) {
          case 'take_screenshot': return Promise.resolve({ base64: 'AAAA', width: 1920, height: 1080, monitor_id: 0 });
          case 'get_screen_size': return Promise.resolve([1920, 1080]);
          case 'browser_probe': return Promise.resolve(false);
          case 'desktop_read':
            // region != null → precision read returns the child card.
            return Promise.resolve(JSON.stringify(args.region ? ROBLOX_REGION : ROBLOX_CONTAINER));
          case 'ocr_read': return Promise.resolve('[]');
          default: return Promise.resolve('ok');
        }
      });

      h.responses = [
        JSON.stringify({
          action: 'click_text', target: { text: 'Recently Played' },
          reason: 'open last played game', confidence: 0.8,
          expect: { type: 'none' },
        }),
      ];
      const steps: AgentStep[] = [];
      const res = await runVisionV2Turn(makeCtx(steps));
      expect(res.kind).toBe('continue');

      // The child card center is [515, 295]; the container center is [680, 410].
      expect(invokeMock).toHaveBeenCalledWith('mouse_click', { x: 515, y: 295, button: 'left' });
      expect(invokeMock).not.toHaveBeenCalledWith('mouse_click', { x: 680, y: 410, button: 'left' });

      // It must NOT have blindly invoked the large container.
      expect(invokeMock).not.toHaveBeenCalledWith('desktop_invoke_target', expect.anything());

      // Result reports the refined-point method and the refine debug record.
      const resultStep = steps.find((s) => s.tool === 'v2:click_text' && s.type !== 'tool_call' && s.type !== 'thinking');
      expect(resultStep?.details?.used_method).toBe('mouse_refined_point');
      const refine = resultStep?.details?.refine as { pre_click_refine: boolean; refined_child_id?: string };
      expect(refine.pre_click_refine).toBe(true);
      expect(refine.refined_child_id).toBe('uia_fg|card');
    })();
  });
});

describe('Precision V3 — post-click miss correction', () => {
  it('click reports success but verification fails → refine + re-click a different point', () => {
    return (async () => {
      // Small, high-precision invokable button → no pre-click refine. We make the
      // structured invoke "succeed" but the expected text never appears, so the
      // miss-correction path must re-ground and click a refined point.
      const BTN_SNAPSHOT = {
        window: { title: 'App', process_name: 'app', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        snapshot_token: 'tok-btn',
        targets: [{
          id: 'fg|ok', name: 'OK', role: 'Button', automation_id: 'okBtn',
          bounds: { x: 100, y: 100, width: 200, height: 100 },
          enabled: true, visible: true, focused: false, window_title: 'App',
          can_invoke: true, can_scroll: false, is_keyboard_focusable: true,
          children_count: 0, precision_level: 'high', target_confidence: 0.9,
          click_strategy: 'invoke', is_large_container: false,
        }],
      };
      const REGION_CHILD = {
        window: { title: 'App', process_name: 'app', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        snapshot_token: 'tok-rg',
        targets: [{
          id: 'fg|okinner', name: 'OK label', role: 'Text', automation_id: 'okInner',
          bounds: { x: 120, y: 120, width: 60, height: 40 },
          enabled: true, visible: true, focused: false, window_title: 'App',
          can_invoke: true, can_scroll: false, is_keyboard_focusable: true,
          children_count: 0, precision_level: 'high', target_confidence: 0.8,
          click_strategy: 'invoke', is_large_container: false,
        }],
      };

      invokeMock.mockImplementation((cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd) {
          case 'take_screenshot': return Promise.resolve({ base64: 'AAAA', width: 1920, height: 1080, monitor_id: 0 });
          case 'get_screen_size': return Promise.resolve([1920, 1080]);
          case 'browser_probe': return Promise.resolve(false);
          case 'desktop_read': return Promise.resolve(JSON.stringify(args.region ? REGION_CHILD : BTN_SNAPSHOT));
          case 'ocr_read': return Promise.resolve('[]');
          case 'desktop_invoke_target': return Promise.resolve('{"status":"invoked"}');
          default: return Promise.resolve('ok');
        }
      });

      h.responses = [
        JSON.stringify({
          action: 'click_text', target: { text: 'OK' },
          reason: 'confirm', confidence: 0.9,
          expect: { type: 'text_appears', value: 'Saved', required: true },
        }),
      ];
      const steps: AgentStep[] = [];
      const res = await runVisionV2Turn(makeCtx(steps));
      expect(res.kind).toBe('continue');

      // The structured invoke fired first...
      expect(invokeMock).toHaveBeenCalledWith('desktop_invoke_target', { id: 'fg|ok', snapshotToken: 'tok-btn' });
      // ...then the miss correction clicked the refined child point [150, 140].
      expect(invokeMock).toHaveBeenCalledWith('mouse_click', { x: 150, y: 140, button: 'left' });

      const resultStep = steps.find((s) => s.tool === 'v2:click_text' && s.type !== 'tool_call' && s.type !== 'thinking');
      const refine = resultStep?.details?.refine as { post_click_miss_correction: boolean };
      expect(refine.post_click_miss_correction).toBe(true);
    })();
  });
});
