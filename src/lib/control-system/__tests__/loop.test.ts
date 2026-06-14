import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStep } from '../loop';

const invokeMock = vi.fn();
const openRouterMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('../../openrouter', () => ({ callOpenRouterWithTools: openRouterMock }));
vi.mock('../../supabase', () => ({ supabase: { rpc: rpcMock } }));

function callbacks(steps: AgentStep[], extra: Record<string, unknown> = {}) {
  return {
    onStatus: vi.fn(),
    onStep: (s: AgentStep) => { steps.push(s); },
    onAskUser: vi.fn(async () => 'yes'),
    onComplete: vi.fn(),
    onError: vi.fn(),
    ...extra,
  } as never;
}

describe('no-mouse control loop', () => {
  beforeEach(() => { invokeMock.mockReset(); openRouterMock.mockReset(); rpcMock.mockReset(); });

  it('completes via task.complete', async () => {
    openRouterMock.mockImplementation(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"Done"}'));
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const cbs = callbacks(steps);
    await runControlLoop('do a thing', 'model', 'user', cbs, { aborted: false });
    expect((cbs as { onComplete: ReturnType<typeof vi.fn> }).onComplete).toHaveBeenCalledWith('Done');
  });

  it('rejects a mouse-click request and never invokes a mouse command', async () => {
    openRouterMock
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"mouse_click","x":100,"y":200}'))
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"Stopped"}'));
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    await runControlLoop('click the center of the screen', 'model', 'user', callbacks(steps), { aborted: false });
    expect(steps).toContainEqual(expect.objectContaining({ type: 'error', error: 'mouse_cursor_visual_not_supported' }));
    expect(invokeMock).not.toHaveBeenCalledWith('mouse_click', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('soc_mouse_click', expect.anything());
  });

  it('executes a deterministic file action through the guarded runner', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'fs_mkdir') return 'Created';
      return undefined;
    });
    openRouterMock
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"file.mkdir","path":"~/Acme","recursive":true}'))
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"Folder created"}'));
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const audits: unknown[] = [];
    await runControlLoop('make a folder', 'model', 'user', callbacks(steps, { onAudit: (e: unknown) => audits.push(e) }), { aborted: false });
    expect(invokeMock).toHaveBeenCalledWith('fs_mkdir', { path: '~/Acme', recursive: true });
    expect(audits.length).toBeGreaterThan(0);
  });
});
