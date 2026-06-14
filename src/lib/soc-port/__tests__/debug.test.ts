import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('SOC port debug writer', () => {
  it('writes requested artifact name and base64 compatibility file', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { createSocPortDebugWriter } = await import('../debug');
    const writer = createSocPortDebugWriter('run/test', 1);
    await writer.writeBase64('raw-screenshot.jpg', 'abc');
    expect(invokeMock).toHaveBeenCalledWith('file_write', {
      path: '~/.larund-click/soc-port/run_test/step-001/raw-screenshot.jpg',
      content: 'abc',
    });
    expect(invokeMock).toHaveBeenCalledWith('file_write', {
      path: '~/.larund-click/soc-port/run_test/step-001/raw-screenshot.jpg.base64',
      content: 'abc',
    });
  });
});
