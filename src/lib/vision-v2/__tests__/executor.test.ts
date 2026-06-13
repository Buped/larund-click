import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { executeV2 } from '../executor';
import type { ScreenState, ScreenElement, ActionPlan } from '../types';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function state(elements: ScreenElement[]): ScreenState {
  return {
    screenshot_width: 1920, screenshot_height: 1080, screen_width: 1920, screen_height: 1080,
    dpi_scale: 1, active_window_title: 'Test', active_app_name: 'test', elements,
    timestamp: new Date().toISOString(),
  };
}
function elem(p: Partial<ScreenElement> & { id: string; source: ScreenElement['source'] }): ScreenElement {
  return {
    role: 'Button', name: 'X', text: 'X', bbox: [100, 100, 200, 140], center: [150, 120],
    clickable_point: [150, 120], clickable: true, confidence: 0.8, visible: true, ...p,
  } as ScreenElement;
}

beforeEach(() => { invokeMock.mockReset(); invokeMock.mockResolvedValue('ok'); });

describe('executeV2 method selection (fallback order)', () => {
  it('hotkey → key_combo', async () => {
    const r = await executeV2({ action: 'hotkey', keys: ['ctrl', 'shift', 'x'], reason: '', confidence: 1 }, state([]));
    expect(invokeMock).toHaveBeenCalledWith('key_combo', { keys: ['ctrl', 'shift', 'x'] });
    expect(r.used_method).toBe('hotkey');
    expect(r.success).toBe(true);
  });

  it('DOM click_element → browser_click (no mouse)', async () => {
    const el = elem({ id: 'dom_0', source: 'dom', name: 'Sign in', metadata: { domTarget: 'Sign in' }, bbox: [0, 0, 0, 0] });
    const plan: ActionPlan = { action: 'click_element', target: { element_id: 'dom_0' }, reason: '', confidence: 1 };
    const r = await executeV2(plan, state([el]));
    expect(invokeMock).toHaveBeenCalledWith('browser_click', { target: 'Sign in' });
    expect(r.used_method).toBe('dom');
    expect(r.success).toBe(true);
  });

  it('UIA invokable click_element → desktop_invoke_target', async () => {
    const el = elem({ id: 'uia_1', source: 'uia', name: 'OK', metadata: { uiaId: 'fg|1', snapshot_token: 'tok', can_invoke: true } });
    const plan: ActionPlan = { action: 'click_element', target: { element_id: 'uia_1' }, reason: '', confidence: 1 };
    const r = await executeV2(plan, state([el]));
    expect(invokeMock).toHaveBeenCalledWith('desktop_invoke_target', { id: 'fg|1', snapshotToken: 'tok' });
    expect(r.used_method).toBe('uia_invoke');
  });

  it('pixel-only element → safe-point mouse_click', async () => {
    const el = elem({ id: 'ocr_0', source: 'ocr', name: 'Buy', metadata: { ocr: true } });
    const plan: ActionPlan = { action: 'click_element', target: { element_id: 'ocr_0' }, reason: '', confidence: 1 };
    const r = await executeV2(plan, state([el]));
    expect(invokeMock).toHaveBeenCalledWith('mouse_click', { x: 150, y: 120, button: 'left' });
    expect(r.used_method).toBe('mouse_safe_point');
  });

  it('click_text fuzzy-resolves then clicks the matched element', async () => {
    const el = elem({ id: 'uia_2', source: 'uia', name: 'Extensions', metadata: { uiaId: 'fg|2', snapshot_token: 't', can_invoke: true } });
    const plan: ActionPlan = { action: 'click_text', target: { text: 'extensions' }, reason: '', confidence: 1 };
    const r = await executeV2(plan, state([el]));
    expect(r.chosenElementId).toBe('uia_2');
    expect(invokeMock).toHaveBeenCalledWith('desktop_invoke_target', { id: 'fg|2', snapshotToken: 't' });
  });

  it('type_text into a DOM input → browser_type', async () => {
    const el = elem({ id: 'dom_1', source: 'dom', role: 'Edit', name: 'Email', metadata: { domTarget: 'Email', isInput: true }, bbox: [0, 0, 0, 0] });
    const plan: ActionPlan = { action: 'type_text', target: { element_id: 'dom_1' }, text: 'a@b.com', reason: '', confidence: 1 };
    const r = await executeV2(plan, state([el]));
    expect(invokeMock).toHaveBeenCalledWith('browser_type', { target: 'Email', text: 'a@b.com' });
    expect(r.used_method).toBe('dom');
  });

  it('raw_click is performed only with valid coords and reports mouse_raw', async () => {
    const r = await executeV2({ action: 'raw_click', target: { x: 800, y: 400 }, reason: '', confidence: 1 }, state([]));
    expect(invokeMock).toHaveBeenCalledWith('mouse_click', { x: 800, y: 400, button: 'left' });
    expect(r.used_method).toBe('mouse_raw');
  });

  it('raw_click off-screen is rejected without clicking', async () => {
    const r = await executeV2({ action: 'raw_click', target: { x: 9999, y: 9999 }, reason: '', confidence: 1 }, state([]));
    expect(invokeMock).not.toHaveBeenCalledWith('mouse_click', expect.anything());
    expect(r.success).toBe(false);
  });

  it('click_element with a missing id asks for refine', async () => {
    const r = await executeV2({ action: 'click_element', target: { element_id: 'nope' }, reason: '', confidence: 1 }, state([]));
    expect(r.success).toBe(false);
    expect(r.needsRefine).toBe(true);
  });
});
