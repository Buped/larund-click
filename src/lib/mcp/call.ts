import { addEvidence } from '../tasks/store';
import { MemoryAuditLogger, newAuditId, sanitizeArgs, summarizeOutput } from '../tools/audit';
import { DEFAULT_POLICY, type RiskPolicy } from '../tools/policy';
import type { ApprovalService } from '../tools/types';
import { AutoApprovalService } from '../tools/approvals';
import { mcpClient } from './client';
import { getMcpServer, getMcpToolSnapshot } from './store';

export async function callMcpTool(args: {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  serverId: string;
  toolName: string;
  input: Record<string, unknown>;
  approvals?: ApprovalService;
  policy?: RiskPolicy;
  audit?: MemoryAuditLogger;
}): Promise<{ success: boolean; output: string; error?: string }> {
  const server = await getMcpServer(args.serverId);
  const tool = await getMcpToolSnapshot(args.serverId, args.toolName);
  const audit = args.audit ?? new MemoryAuditLogger();
  if (!server || !server.enabled || server.status === 'disabled') return block('mcp_server_disabled');
  if (!tool || !tool.enabled || !tool.approved) return block('mcp_tool_not_approved');
  const decision = (args.policy ?? DEFAULT_POLICY)[tool.risk] ?? 'ask';
  let approvalId: string | undefined;
  if (decision === 'block') return block('mcp_call_blocked_by_policy');
  if (decision === 'ask') {
    approvalId = `mcp-approval-${Date.now()}`;
    const ok = await (args.approvals ?? new AutoApprovalService()).request({
      action: { action: 'connection.call', connection: `mcp:${server.id}`, tool: tool.name, args: args.input },
      risk: tool.risk,
      reason: `MCP tool ${server.name}/${tool.name} is classified ${tool.risk}.`,
      argsSummary: sanitizeArgs(args.input),
      preview: tool.description,
    });
    if (!ok) return block('approval_denied', true);
  }
  const result = await mcpClient().callTool(server.id, tool.name, args.input);
  audit.record({
    id: newAuditId(),
    timestamp: Date.now(),
    sessionId: args.taskRunId ?? `mcp:${server.id}`,
    action: 'connection.call',
    argsSummary: sanitizeArgs({ source: 'mcp', serverId: server.id, toolName: tool.name, input: args.input }),
    risk: tool.risk,
    category: 'connections',
    success: result.success,
    outputSummary: summarizeOutput(result.output),
    error: result.error,
    approvalId,
    metadataHash: tool.metadataHash,
    skill: undefined,
  } as never);
  if (args.taskRunId) {
    await addEvidence({
      taskRunId: args.taskRunId,
      userId: args.userId,
      workspaceId: args.workspaceId,
      kind: result.success ? 'connection_output' : 'error',
      title: `MCP ${server.name}/${tool.name}`,
      content: summarizeOutput(result.output || result.error, 1000) ?? '',
      tool: 'mcp.call',
      risk: tool.risk,
      success: result.success,
      metadata: { source: 'mcp', serverId: server.id, toolName: tool.name, metadataHash: tool.metadataHash },
    });
  }
  return { success: result.success, output: result.output, error: result.error };

  function block(error: string, approvalDenied = false) {
    audit.record({
      id: newAuditId(),
      timestamp: Date.now(),
      sessionId: args.taskRunId ?? `mcp:${args.serverId}`,
      action: 'connection.call',
      argsSummary: sanitizeArgs({ source: 'mcp', serverId: args.serverId, toolName: args.toolName, input: args.input }),
      risk: tool?.risk ?? 'process_exec',
      category: 'connections',
      success: false,
      error,
      approvalId: approvalDenied ? approvalId : undefined,
    } as never);
    return { success: false, output: '', error };
  }
}
