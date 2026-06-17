// Higgsfield runtime entry for the agent/chat. Exposes a blocker check and an
// approval-gated tool executor. Reuses callMcpTool so every call is risk-policy
// gated, audited, and evidenced; nothing runs unless the user approved the tool.

import { callMcpTool } from '../call';
import type { ApprovalService } from '../../tools/types';
import type { MemoryAuditLogger } from '../../tools/audit';
import type { RiskPolicy } from '../../tools/policy';
import { getHiggsfieldServer, higgsfieldConnectionState, type HiggsfieldCtx } from './connect';

export interface HiggsfieldBlocker {
  blocked: true;
  reason: 'connect_required' | 'review_required';
  message: string;
}

/** Returns a blocker if Higgsfield can't be used yet, else null. */
export async function higgsfieldBlocker(ctx: HiggsfieldCtx): Promise<HiggsfieldBlocker | null> {
  const status = await higgsfieldConnectionState(ctx);
  if (status.state === 'ready') return null;
  if (status.state === 'review_tools') {
    return { blocked: true, reason: 'review_required', message: 'Higgsfield tools need review/approval in Connections → Higgsfield.' };
  }
  return {
    blocked: true,
    reason: 'connect_required',
    message: 'Higgsfield isn’t connected yet. Open Connections → Higgsfield and connect (CLI or MCP URL).',
  };
}

export interface RunHiggsfieldArgs {
  ctx: HiggsfieldCtx;
  taskRunId?: string;
  toolName: string;
  input: Record<string, unknown>;
  approvals?: ApprovalService;
  policy?: RiskPolicy;
  audit?: MemoryAuditLogger;
}

/**
 * Run a Higgsfield tool through the approval + evidence pipeline. Returns a
 * structured blocker if not connected, instead of a fake success.
 */
export async function runHiggsfieldTool(
  args: RunHiggsfieldArgs,
): Promise<{ success: boolean; output: string; error?: string; blocker?: HiggsfieldBlocker }> {
  const server = await getHiggsfieldServer(args.ctx);
  if (!server) {
    const blocker = (await higgsfieldBlocker(args.ctx))!;
    return { success: false, output: '', error: blocker.reason, blocker };
  }
  const result = await callMcpTool({
    userId: args.ctx.userId,
    workspaceId: args.ctx.workspaceId,
    taskRunId: args.taskRunId,
    serverId: server.id,
    toolName: args.toolName,
    input: args.input,
    approvals: args.approvals,
    policy: args.policy,
    audit: args.audit,
  });
  if (!result.success && (result.error === 'mcp_tool_not_approved' || result.error === 'mcp_server_disabled')) {
    return { ...result, blocker: { blocked: true, reason: 'review_required', message: 'Approve the Higgsfield tool in Connections first.' } };
  }
  return result;
}
