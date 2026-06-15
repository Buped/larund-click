import { MemoryAuditLogger, newAuditId, sanitizeArgs, summarizeOutput } from '../tools/audit';
import { DEFAULT_POLICY, type RiskPolicy } from '../tools/policy';
import type { ApprovalService } from '../tools/types';
import { AutoApprovalService } from '../tools/approvals';
import { addEvidence } from '../tasks/store';
import { getCustomApiConnection, listCustomApiTools } from './store';

export async function callCustomApiTool(args: {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  connectionId: string;
  toolId: string;
  input: Record<string, unknown>;
  approvals?: ApprovalService;
  policy?: RiskPolicy;
  audit?: MemoryAuditLogger;
}): Promise<{ success: boolean; output: string; error?: string }> {
  const connection = await getCustomApiConnection(args.connectionId);
  const tool = (await listCustomApiTools(args.connectionId)).find((t) => t.id === args.toolId);
  const audit = args.audit ?? new MemoryAuditLogger();
  if (!connection?.enabled || !tool?.enabled) return block('custom_api_tool_disabled');
  const decision = (args.policy ?? DEFAULT_POLICY)[tool.risk] ?? 'ask';
  if (decision === 'block') return block('custom_api_blocked_by_policy');
  let approvalId: string | undefined;
  if (decision === 'ask') {
    approvalId = `custom-api-approval-${Date.now()}`;
    const ok = await (args.approvals ?? new AutoApprovalService()).request({
      action: { action: 'connection.call', connection: `custom_api:${connection.id}`, tool: tool.name, args: args.input },
      risk: tool.risk,
      reason: `Custom API tool ${connection.name}/${tool.name} is classified ${tool.risk}.`,
      argsSummary: sanitizeArgs(args.input),
    });
    if (!ok) return block('approval_denied');
  }

  const url = renderUrl(connection.baseUrl, tool.pathTemplate, args.input);
  const output = `Custom API ${tool.method} ${url} queued/executed in MVP adapter.`;
  audit.record({
    id: newAuditId(),
    timestamp: Date.now(),
    sessionId: args.taskRunId ?? `custom-api:${connection.id}`,
    action: 'connection.call',
    argsSummary: sanitizeArgs({ source: 'custom_api', connectionId: connection.id, toolId: tool.id, input: args.input }),
    risk: tool.risk,
    category: 'connections',
    success: true,
    outputSummary: summarizeOutput(output),
    approvalId,
  });
  if (args.taskRunId) {
    await addEvidence({
      taskRunId: args.taskRunId,
      userId: args.userId,
      workspaceId: args.workspaceId,
      kind: 'connection_output',
      title: `Custom API ${connection.name}/${tool.name}`,
      content: output,
      tool: 'custom_api.call',
      risk: tool.risk,
      success: true,
      metadata: { source: 'custom_api', connectionId: connection.id, toolId: tool.id },
    });
  }
  return { success: true, output };

  function block(error: string) {
    audit.record({
      id: newAuditId(),
      timestamp: Date.now(),
      sessionId: args.taskRunId ?? `custom-api:${args.connectionId}`,
      action: 'connection.call',
      argsSummary: sanitizeArgs({ source: 'custom_api', connectionId: args.connectionId, toolId: args.toolId, input: args.input }),
      risk: tool?.risk ?? 'external_write',
      category: 'connections',
      success: false,
      error,
    });
    return { success: false, output: '', error };
  }
}

function renderUrl(baseUrl: string, pathTemplate: string, input: Record<string, unknown>): string {
  const path = pathTemplate.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(String(input[key] ?? '')));
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
