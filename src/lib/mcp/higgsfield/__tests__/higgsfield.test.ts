import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { resetRecordBackendForTests } from '../../../coworker/persistence';
import { AutoApprovalService, PromptApprovalService } from '../../../tools/approvals';
import { createTaskRun, listEvidence } from '../../../tasks/store';
import { listMcpTools, getMcpToolSnapshot, setMcpToolApproval } from '../../store';
import { listMcpUnifiedTools } from '../../registry-bridge';
import { callMcpTool } from '../../call';
import { setHiggsfieldRunner, sanitizeCliOutput, probeHiggsfieldCli, type CliResult } from '../cli';
import { connectHiggsfieldCli, getHiggsfieldServer, higgsfieldConnectionState } from '../connect';
import { runHiggsfieldTool, higgsfieldBlocker } from '../runtime';

const ctx = { userId: 'u1', workspaceId: 'ws1' };

// A scriptable CLI: maps a command substring → result.
function scriptRunner(routes: Array<[RegExp, Partial<CliResult>]>) {
  return async (command: string): Promise<CliResult> => {
    for (const [re, res] of routes) {
      if (re.test(command)) return { success: true, stdout: '', stderr: '', exitCode: 0, ...res };
    }
    return { success: false, stdout: '', stderr: 'command not recognized', exitCode: 1 };
  };
}

const READY = scriptRunner([
  [/\bversion\b/, { success: true, stdout: 'higgsfield 1.2.3' }],
  [/account --json/, { success: true, stdout: '{"email":"a@b.co","credits":42}' }],
  [/models list --json/, { success: true, stdout: '{"models":[{"id":"soul","name":"Soul"}]}' }],
  [/generate create/, { success: true, stdout: '{"id":"job_123","status":"queued"}' }],
  [/generate wait/, { success: false, stderr: 'request timed out', exitCode: 1 }],
]);

beforeEach(() => resetRecordBackendForTests());
afterEach(() => setHiggsfieldRunner(null));

describe('Higgsfield CLI adapter', () => {
  it('probe reports not_installed when the binary is missing', async () => {
    setHiggsfieldRunner(async () => ({ success: false, stdout: '', stderr: "'higgsfield' is not recognized", exitCode: 1 }));
    expect((await probeHiggsfieldCli()).state).toBe('not_installed');
  });

  it('probe reports auth_required when installed but not signed in', async () => {
    setHiggsfieldRunner(scriptRunner([
      [/\bversion\b/, { success: true, stdout: 'higgsfield 1.2.3' }],
      [/account/, { success: false, stderr: 'Please run higgsfield auth login', exitCode: 1 }],
    ]));
    const probe = await probeHiggsfieldCli();
    expect(probe.state).toBe('auth_required');
  });

  it('connect (ready) discovers the curated tool catalog and never fakes connected', async () => {
    setHiggsfieldRunner(READY);
    const status = await connectHiggsfieldCli(ctx);
    expect(status.state).toBe('review_tools'); // discovered but not yet approved
    expect(status.server?.status).toBe('connected');
    const tools = await listMcpTools(status.server!.id);
    expect(tools.length).toBe(16);
    // Explicit risk overrides from the catalog.
    expect((await getMcpToolSnapshot(status.server!.id, 'higgsfield.account_status'))!.risk).toBe('read_only');
    expect((await getMcpToolSnapshot(status.server!.id, 'higgsfield.generate_create'))!.risk).toBe('external_write');
    expect((await getMcpToolSnapshot(status.server!.id, 'higgsfield.upload_image'))!.risk).toBe('external_write');
  });

  it('auth-missing connect surfaces auth_required, not connected', async () => {
    setHiggsfieldRunner(scriptRunner([
      [/\bversion\b/, { success: true, stdout: 'higgsfield 1.2.3' }],
      [/account/, { success: false, stderr: 'sign in required', exitCode: 1 }],
    ]));
    const status = await connectHiggsfieldCli(ctx);
    expect(status.state).toBe('auth_required');
    expect(status.server?.status).toBe('auth_required');
  });

  it('unapproved tools are never exposed to the agent; approval makes them available', async () => {
    setHiggsfieldRunner(READY);
    const status = await connectHiggsfieldCli(ctx);
    let unified = await listMcpUnifiedTools(ctx);
    expect(unified.find((t) => t.name === 'higgsfield.model_list')).toBeUndefined();
    const tool = (await getMcpToolSnapshot(status.server!.id, 'higgsfield.model_list'))!;
    await setMcpToolApproval(tool.id, { approved: true, enabled: true });
    unified = await listMcpUnifiedTools(ctx);
    expect(unified.find((t) => t.name === 'higgsfield.model_list')).toBeTruthy();
  });

  it('runs an approved read tool, parses JSON, and records evidence', async () => {
    setHiggsfieldRunner(READY);
    await connectHiggsfieldCli(ctx);
    const server = (await getHiggsfieldServer(ctx))!;
    const tool = (await getMcpToolSnapshot(server.id, 'higgsfield.model_list'))!;
    await setMcpToolApproval(tool.id, { approved: true, enabled: true });
    const task = await createTaskRun({ userId: 'u1', workspaceId: 'ws1', sessionId: 's', title: 'hf', originalPrompt: 'hf', modelId: 'core', autonomyMode: 'semi' });
    const res = await runHiggsfieldTool({ ctx, taskRunId: task.id, toolName: 'higgsfield.model_list', input: {}, approvals: new AutoApprovalService() });
    expect(res.success).toBe(true);
    expect(res.output).toContain('Soul');
    expect(await listEvidence(task.id)).toHaveLength(1);
  });

  it('generation requires approval (denied → blocked, nothing generated)', async () => {
    setHiggsfieldRunner(READY);
    await connectHiggsfieldCli(ctx);
    const server = (await getHiggsfieldServer(ctx))!;
    const tool = (await getMcpToolSnapshot(server.id, 'higgsfield.generate_create'))!;
    await setMcpToolApproval(tool.id, { approved: true, enabled: true });
    const res = await runHiggsfieldTool({
      ctx, toolName: 'higgsfield.generate_create', input: { model_id: 'soul', prompt: 'a cat' },
      approvals: new PromptApprovalService(undefined, 'deny'),
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('approval_denied');
  });

  it('polling timeout is surfaced as an error, not a hang or fake success', async () => {
    setHiggsfieldRunner(READY);
    await connectHiggsfieldCli(ctx);
    const server = (await getHiggsfieldServer(ctx))!;
    const tool = (await getMcpToolSnapshot(server.id, 'higgsfield.generate_wait'))!;
    await setMcpToolApproval(tool.id, { approved: true, enabled: true });
    const res = await runHiggsfieldTool({ ctx, toolName: 'higgsfield.generate_wait', input: { job_id: 'job_123', timeout_seconds: 1 }, approvals: new AutoApprovalService() });
    expect(res.success).toBe(false);
    expect(res.error).toBe('higgsfield_poll_timeout');
  });

  it('blocks tool calls when nothing is connected (no fake success)', async () => {
    const blocker = await higgsfieldBlocker(ctx);
    expect(blocker?.reason).toBe('connect_required');
    const res = await runHiggsfieldTool({ ctx, toolName: 'higgsfield.model_list', input: {}, approvals: new AutoApprovalService() });
    expect(res.success).toBe(false);
    expect(res.blocker?.reason).toBe('connect_required');
  });

  it('state derivation: not_configured before any connect', async () => {
    expect((await higgsfieldConnectionState(ctx)).state).toBe('not_configured');
  });

  it('sanitizes tokens/secrets out of CLI output', () => {
    const raw = 'authorization: Bearer abcdef....\naccess_token=eyJhbGciJ9.payloadpart.signature11\nok line';
    const clean = sanitizeCliOutput(raw);
    expect(clean).not.toContain('Bearer abcdef');
    expect(clean).not.toContain('eyJhbGciJ9.payloadpart.signature11');
    expect(clean).toContain('ok line');
  });
});
