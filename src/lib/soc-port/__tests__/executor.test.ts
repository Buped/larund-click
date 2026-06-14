import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('SOC port executor', () => {
  it('click text uses original OCR bbox metadata', async () => {
    invokeMock.mockResolvedValue('clicked');
    const { executeSocPortOperation } = await import('../executor');
    const result = await executeSocPortOperation({
      operation: { thought: 'click banana', operation: 'click', text: 'BANAN' },
      screenshot: { base64: '', width: 100, height: 100, monitorId: 0 },
      ocr: [{ id: 'ocr-1', text: 'BANAN', bbox: [10, 40, 80, 50], confidence: 0.6, source: 'word' }],
    });
    expect(invokeMock).toHaveBeenCalledWith('mouse_click_verified', {
      x: 45,
      y: 45,
      targetLabel: 'BANAN',
      bbox: [10, 40, 80, 50],
      confidence: 0.6,
      source: 'soc-port-ocr',
    });
    expect(result.originalBbox).toEqual([10, 40, 80, 50]);
  });

  it('standard percent click uses pyautogui-style low-level click command', async () => {
    invokeMock.mockResolvedValue('clicked');
    const { executeSocPortOperation } = await import('../executor');
    await executeSocPortOperation({
      operation: { thought: 'click', operation: 'click', x: '0.5', y: '0.25' },
      screenshot: { base64: '', width: 200, height: 100, monitorId: 0 },
      ocr: [],
    });
    expect(invokeMock).toHaveBeenCalledWith('soc_mouse_click', { x: 100, y: 25, button: 'left' });
  });
});
