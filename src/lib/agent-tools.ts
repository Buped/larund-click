import type { ControlAction, ControlToolResult } from './control-system/types';
import { CONTROL_SYSTEM_PROMPT } from './control-system/prompt';
import { parseControlAction } from './control-system/parser';
import { runControlAction } from './tools/run';
import { MemoryAuditLogger } from './tools/audit';
import { AutoApprovalService } from './tools/approvals';
import type { ToolContext } from './tools/types';

export type ToolName = ControlAction['action'];
export type ToolCall = ControlAction;
export type ToolResult = ControlToolResult;

export function parseToolCall(text: string): ToolCall | null {
  return parseControlAction(text);
}

/** One-shot execution helper (auto-approving, no session) for simple call sites. */
export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  const ctx: ToolContext = {
    userId: '',
    sessionId: 'oneshot',
    workspaceRoot: '~',
    task: '',
    audit: new MemoryAuditLogger(),
    approvals: new AutoApprovalService(),
  };
  return runControlAction(tool, ctx);
}

export const AGENT_TOOLS_PROMPT = CONTROL_SYSTEM_PROMPT;
export const AGENT_TOOLS_PROMPT_V2 = CONTROL_SYSTEM_PROMPT;
