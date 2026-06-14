import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('SOC debug writer', () => {
  it('writes base64 artifacts with the requested filename and compatibility suffix', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { createSocDebugWriter } = await import('../debug');
    const writer = createSocDebugWriter('run/test', 1);

    await writer.writeBase64('raw-screenshot.jpg', 'abc123');

    expect(invokeMock).toHaveBeenCalledWith('file_write', {
      path: '~/.larund-click/soc-mode/run_test/step-001/raw-screenshot.jpg',
      content: 'abc123',
    });
    expect(invokeMock).toHaveBeenCalledWith('file_write', {
      path: '~/.larund-click/soc-mode/run_test/step-001/raw-screenshot.jpg.base64',
      content: 'abc123',
    });
  });
});
