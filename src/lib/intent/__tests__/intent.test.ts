import { describe, it, expect } from 'vitest';
import { heuristicIntent } from '../classify';

describe('intent heuristic router', () => {
  it('routes a conceptual question to chat (acceptance test 1)', () => {
    const r = heuristicIntent({ text: 'Mi a különbség a connection és az MCP között?', hasReferences: false });
    expect(r?.mode).toBe('chat');
    expect((r?.confidence ?? 0)).toBeGreaterThanOrEqual(0.8);
  });

  it('routes a file action to agent (acceptance test 2)', () => {
    const r = heuristicIntent({ text: 'Hozz létre az Asztalon egy larund_test.txt fájlt, írd bele hogy hello, majd olvasd vissza.', hasReferences: false });
    expect(r?.mode).toBe('agent');
    expect((r?.confidence ?? 0)).toBeGreaterThanOrEqual(0.8);
    expect(r?.requiredCapabilities).toContain('files');
  });

  it('routes an English explanation to chat', () => {
    const r = heuristicIntent({ text: 'Explain how OAuth works', hasReferences: false });
    expect(r?.mode).toBe('chat');
  });

  it('routes a create request to agent', () => {
    const r = heuristicIntent({ text: 'Create a spreadsheet with my expenses', hasReferences: false });
    expect(r?.mode).toBe('agent');
  });

  it('treats an analysis-only question about an attachment as chat', () => {
    const r = heuristicIntent({ text: 'What do you think about this document?', hasReferences: true });
    expect(r?.mode).toBe('chat');
  });

  it('treats an output request about an attachment as agent', () => {
    const r = heuristicIntent({ text: 'Export this into a file', hasReferences: true });
    expect(r?.mode).toBe('agent');
  });

  it('asks to clarify a bare attachment with no instruction', () => {
    const r = heuristicIntent({ text: '', hasReferences: true });
    expect(r?.mode).toBe('clarify');
  });
});
