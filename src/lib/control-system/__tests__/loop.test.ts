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

  it('completes via task.complete after a verified action', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'shell_run') return { stdout: 'ok', stderr: '', exit_code: 0, success: true };
      return undefined;
    });
    openRouterMock
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"cli.run","cmd":"echo hi"}'))
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"Done"}'));
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const cbs = callbacks(steps);
    await runControlLoop('do a thing', 'model', 'user', cbs, { aborted: false }, { sessionId: 'sess-complete' });
    expect((cbs as { onComplete: ReturnType<typeof vi.fn> }).onComplete).toHaveBeenCalledWith('Done');
  });

  it('rejects task.complete with no work, then completes once work is verified', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'shell_run') return { stdout: 'ok', stderr: '', exit_code: 0, success: true };
      return undefined;
    });
    openRouterMock
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"too soon"}'))
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"cli.run","cmd":"echo hi"}'))
      .mockImplementationOnce(async (_m, _md, _u, onChunk) => onChunk('{"action":"task.complete","summary":"Done"}'));
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const cbs = callbacks(steps);
    await runControlLoop('do a thing', 'model', 'user', cbs, { aborted: false }, { sessionId: 'sess-reject' });
    expect(steps).toContainEqual(expect.objectContaining({ type: 'error', error: 'completion_rejected' }));
    expect((cbs as { onComplete: ReturnType<typeof vi.fn> }).onComplete).toHaveBeenCalledWith('Done');
  });

  it('rejects completing a Google Sheets task after only opening the page', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'browser_open') return 'Opened';
      return undefined;
    });
    let turn = 0;
    openRouterMock.mockImplementation(async (_m: unknown, _md: unknown, _u: unknown, onChunk: (c: string) => void) => {
      turn += 1;
      if (turn === 1) return onChunk('{"action":"browser.open","url":"https://sheets.new"}');
      return onChunk('{"action":"task.complete","summary":"opened the sheet"}');
    });
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const cbs = callbacks(steps);
    await runControlLoop(
      'Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.',
      'model', 'user', cbs, { aborted: false }, { sessionId: 'sess-sheet' },
    );
    expect(steps).toContainEqual(expect.objectContaining({ type: 'error', error: 'completion_rejected' }));
    expect((cbs as { onComplete: ReturnType<typeof vi.fn> }).onComplete).not.toHaveBeenCalled();
  });

  it('completes a file move task after file.list verification', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'dir_list') return ['a.txt', 'b.txt'];
      if (cmd === 'fs_mkdir') return 'Created';
      if (cmd === 'fs_move') return 'Moved';
      return undefined;
    });
    const seq = [
      '{"action":"file.list","path":"~/Desktop"}',
      '{"action":"file.mkdir","path":"~/Desktop/txts","recursive":true}',
      '{"action":"file.move","from":"~/Desktop/a.txt","to":"~/Desktop/txts/a.txt"}',
      '{"action":"file.list","path":"~/Desktop/txts"}',
      '{"action":"task.complete","summary":"Moved txt files into the folder"}',
    ];
    let i = 0;
    openRouterMock.mockImplementation(async (_m: unknown, _md: unknown, _u: unknown, onChunk: (c: string) => void) =>
      onChunk(seq[Math.min(i++, seq.length - 1)]),
    );
    const { runControlLoop } = await import('../loop');
    const steps: AgentStep[] = [];
    const cbs = callbacks(steps);
    await runControlLoop(
      'Create a folder on my desktop and move every txt file to it',
      'model', 'user', cbs, { aborted: false }, { sessionId: 'sess-files' },
    );
    expect((cbs as { onComplete: ReturnType<typeof vi.fn> }).onComplete).toHaveBeenCalledWith('Moved txt files into the folder');
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
