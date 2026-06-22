import type { ControlAction, ControlToolResult } from '../control-system/types';
import { performControlAction } from '../control-system/executor';
import { categoryOf, TOOL_CATALOG } from './registry';
import { decide, DEFAULT_POLICY, type RiskPolicy } from './policy';
import { newAuditId, sanitizeArgs, summarizeOutput } from './audit';
import type { ToolContext, ToolCategory } from './types';

const SKILL_CONTROL_ACTIONS = new Set(['skill.run', 'task.complete', 'ask_user', 'approval.request']);

// The core local toolset a general assistant ALWAYS has, regardless of which
// skills are active. Skills ADD specialized capabilities (browser, connections,
// MCP, process exec, app control); they must not strip the fundamental ability to
// read AND write/move local files, spreadsheets, documents and artifacts. Without
// this, a read-only skill like `task-verification` being active would block
// `file.move`, forcing the agent to ask the user to move files by hand.
//
// Safety is preserved by the risk policy below: destructive ops (`file.delete`)
// and process exec (`cli.run`) are excluded here and stay skill-gated, and every
// local write is still subject to policy/approval.
const CORE_BASELINE_CATEGORIES = new Set<ToolCategory>(['files', 'documents', 'data', 'artifacts', 'clipboard']);
const CORE_ALWAYS_ALLOWED = new Set<string>(
  TOOL_CATALOG
    .filter((tool) => CORE_BASELINE_CATEGORIES.has(tool.category))
    .filter((tool) => tool.baseRisk !== 'destructive' && tool.baseRisk !== 'process_exec')
    .map((tool) => tool.name),
);

function skillAllows(action: ControlAction, ctx: ToolContext): { ok: boolean; reason?: string } {
  const active = ctx.activeSkills?.filter((skill) => skill.allowedTools.length) ?? [];
  if (!active.length || SKILL_CONTROL_ACTIONS.has(action.action)) return { ok: true };
  if (CORE_ALWAYS_ALLOWED.has(action.action)) return { ok: true };
  const allowed = new Set([...active.flatMap((skill) => skill.allowedTools), ...CORE_ALWAYS_ALLOWED]);
  if (allowed.has(action.action)) return { ok: true };
  return {
    ok: false,
    reason: `blocked_by_active_skill_allowed_tools:${action.action}; active=${active.map((s) => s.name).join(', ')}; allowed=${[...allowed].join(', ')}`,
  };
}

/**
 * The single gated entry point for executing an action: schema is already
 * guaranteed by the parser; here we apply policy → approval → execute → audit.
 */
export async function runControlAction(
  action: ControlAction,
  ctx: ToolContext,
  policy: RiskPolicy = DEFAULT_POLICY,
): Promise<ControlToolResult> {
  const started = Date.now();
  const { risk, decision } = decide(action, policy);
  const category = categoryOf(action.action);
  const argsSummary = sanitizeArgs(action);

  const audit = (result: ControlToolResult, approvalId?: string) => {
    ctx.audit.record({
      id: newAuditId(),
      timestamp: started,
      sessionId: ctx.sessionId,
      action: action.action,
      argsSummary,
      risk,
      category,
      success: result.success,
      outputSummary: summarizeOutput(result.output),
      error: result.error,
      durationMs: Date.now() - started,
      approvalId,
    });
  };

  const skillGate = skillAllows(action, ctx);
  if (!skillGate.ok) {
    const result: ControlToolResult = { success: false, output: '', error: skillGate.reason };
    audit(result);
    return result;
  }

  if (decision === 'block') {
    const result: ControlToolResult = { success: false, output: '', error: `blocked_by_policy: ${risk}` };
    audit(result);
    return result;
  }

  let approvalId: string | undefined;
  if (decision === 'ask') {
    const approved = await ctx.approvals.request({
      action,
      risk,
      reason: `Action ${action.action} is classified ${risk} and needs approval.`,
      argsSummary,
    });
    if (!approved) {
      const result: ControlToolResult = { success: false, output: '', error: 'approval_denied', approvalRequired: true };
      audit(result);
      return result;
    }
  }

  let result: ControlToolResult;
  try {
    result = await performControlAction(action, ctx);
  } catch (err) {
    result = { success: false, output: '', error: String(err) };
  }
  audit(result, approvalId);
  return result;
}
