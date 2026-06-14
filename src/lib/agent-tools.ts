import type { ControlAction, ControlToolResult } from './control-system/types';
import { CONTROL_SYSTEM_PROMPT } from './control-system/prompt';
import { parseControlAction } from './control-system/parser';
import { executeControlAction } from './control-system/executor';

export type ToolName = ControlAction['action'];
export type ToolCall = ControlAction;
export type ToolResult = ControlToolResult;

export function parseToolCall(text: string): ToolCall | null {
  return parseControlAction(text);
}

export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  return executeControlAction(tool, {
    userId: '',
    task: '',
    addCost: () => undefined,
  });
}

export const AGENT_TOOLS_PROMPT = CONTROL_SYSTEM_PROMPT;
export const AGENT_TOOLS_PROMPT_V2 = CONTROL_SYSTEM_PROMPT;
