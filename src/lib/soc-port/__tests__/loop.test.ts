import { describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const modelMock = vi.fn();
const screenshotMock = vi.fn();
const ocrMock = vi.fn();

vi.mock('../config', () => ({
  getSocPortConfig: () => ({ mode: 'ocr', model: 'openai/gpt-4o', fallbackModel: 'openai/gpt-4.1', maxSteps: 3 }),
}));
vi.mock('../screenshot', () => ({
  takeSocScreenshot: screenshotMock,
}));
vi.mock('../ocr', async () => {
  const actual = await vi.importActual<typeof import('../ocr')>('../ocr');
  return { ...actual, readSocOcr: ocrMock };
});
vi.mock('../model', () => ({
  callSocPortModel: modelMock,
}));
vi.mock('../executor', () => ({
  executeSocPortOperation: executeMock,
}));
vi.mock('../debug', () => ({
  createSocPortDebugWriter: () => ({
    dir: '~/.larund-click/soc-port/test/step-001',
    writeText: vi.fn(),
    writeBase64: vi.fn(),
  }),
}));

describe('SOC port loop', () => {
  it('executes every operation in the model JSON array in order', async () => {
    screenshotMock.mockResolvedValue({ base64: 'shot', width: 100, height: 100, monitorId: 0 });
    ocrMock.mockResolvedValue([]);
    modelMock.mockResolvedValue({
      operations: [
        { thought: 'click banana', operation: 'click', text: 'BANAN' },
        { thought: 'write success', operation: 'write', content: ' SIKERES' },
        { thought: 'done', operation: 'done', summary: 'ok' },
      ],
      raw: '[]',
      model: 'openai/gpt-4o',
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'openai/gpt-4o' },
    });
    executeMock.mockImplementation(async ({ operation }) => ({
      thought: operation.thought,
      operation,
      success: true,
      output: operation.operation,
      source: operation.operation === 'done' ? 'done' : 'keyboard',
    }));

    const { runSocPortLoop } = await import('../loop');
    const result = await runSocPortLoop('Click BANAN and write success', 'user');

    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(3);
    expect(executeMock.mock.calls.map(([arg]) => arg.operation)).toEqual([
      { thought: 'click banana', operation: 'click', text: 'BANAN' },
      { thought: 'write success', operation: 'write', content: ' SIKERES' },
      { thought: 'done', operation: 'done', summary: 'ok' },
    ]);
  });
});
