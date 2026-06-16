// Plans an automation into ordered, editable steps. It NEVER executes tools — it
// only asks the model (or a deterministic heuristic) to produce a plan. The plan
// always includes a verification/read-back step, an approval step when the goal
// involves send/publish/destructive actions, and flags missing dependencies.

import { callOpenRouterJson } from '../openrouter';
import type { AutomationStep, ReferencedContext } from './types';

export interface PlanInput {
  prompt: string;
  referencedContext: ReferencedContext[];
}

export interface PlanResult {
  steps: AutomationStep[];
  missingDependencies: string[];
}

let idc = 0;
function stepId(): string { return `step-${Date.now()}-${(idc++).toString(36)}`; }

function mkStep(order: number, title: string, instruction: string, refs: ReferencedContext[] = [], verificationHint?: string, required = true): AutomationStep {
  return { id: stepId(), title, instruction, referencedContext: refs, required, order, verificationHint };
}

const SEND_RE = /\b(send|email|post|publish|tweet|message|notify|share)\b/i;

/** Deterministic plan used as a fallback and in tests (no network). */
export function heuristicSteps(input: PlanInput): AutomationStep[] {
  const connRefs = input.referencedContext.filter((r) => r.kind === 'connection');
  const steps: AutomationStep[] = [];
  let order = 0;

  if (connRefs.length > 0) {
    steps.push(mkStep(order++, 'Gather inputs', `Read the data needed for the task from ${connRefs.map((c) => c.label).join(', ')} using their read tools (no mouse).`, connRefs, 'Confirm each source returned data.'));
  }
  steps.push(mkStep(order++, 'Do the work', input.prompt.trim() || 'Perform the requested task using the available tools and references.', input.referencedContext, 'Intermediate result looks correct.'));
  steps.push(mkStep(order++, 'Produce output', 'Write the result to a durable output (file/sheet/doc) so it can be verified.', [], 'Output artifact created.'));

  if (SEND_RE.test(input.prompt)) {
    steps.push(mkStep(order++, 'Request approval before sending', 'This task sends/publishes externally. Request explicit approval before the send/publish action.', [], 'User approved the external action.'));
  }

  steps.push(mkStep(order++, 'Verify and read back', 'Read back the produced output and confirm it satisfies the goal before completing. Do not call task.complete until verification passes.', [], 'Output was read back and matches the goal.'));
  return steps;
}

export function missingConnectionDeps(refs: ReferencedContext[], isConnected: (refId: string) => boolean): string[] {
  return refs.filter((r) => r.kind === 'connection' && !isConnected(r.refId)).map((r) => r.label);
}

const PLANNER_SYSTEM = `You plan an AI coworker automation into concrete, ordered steps. You DO NOT execute anything — you only plan.
Rules:
- Larund is a no-mouse operator: use APIs/connections/MCP/files; never mouse/pixels/screenshots.
- Prefer connections/MCP over browser fallback.
- Always include a final verification/read-back step; the agent must not complete without it.
- If the goal sends/publishes externally or is destructive, include an explicit approval step before that action.
- Mark steps that need a connection that may be missing.
Respond with ONLY minified JSON: {"steps":[{"title","instruction","required":true,"verificationHint"}]}`;

/**
 * Generate steps via the model, falling back to the deterministic heuristic on
 * any error (offline, no credits, bad JSON). Always returns a usable plan.
 */
export async function generateAutomationSteps(
  input: PlanInput,
  modelId: string,
  userId: string,
  isConnected: (refId: string) => boolean = () => true,
): Promise<PlanResult> {
  const missing = missingConnectionDeps(input.referencedContext, isConnected);
  try {
    const refLine = input.referencedContext.length ? `\nReferences: ${input.referencedContext.map((r) => `${r.kind}:${r.label}`).join(', ')}` : '';
    const { content } = await callOpenRouterJson(
      [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: `Goal: ${input.prompt}${refLine}` },
      ],
      modelId, userId, true,
    );
    const parsed = extractJson(content);
    const raw = Array.isArray(parsed.steps) ? parsed.steps : [];
    if (raw.length === 0) throw new Error('empty plan');
    const steps: AutomationStep[] = raw.map((s, i) => {
      const x = s as Record<string, unknown>;
      return mkStep(i, String(x.title ?? `Step ${i + 1}`), String(x.instruction ?? ''), i === 0 ? input.referencedContext : [], typeof x.verificationHint === 'string' ? x.verificationHint : undefined, x.required !== false);
    });
    // Guarantee a verification step exists.
    if (!steps.some((s) => /verif|read.?back|confirm/i.test(s.title))) {
      steps.push(mkStep(steps.length, 'Verify and read back', 'Read back the produced output and confirm it satisfies the goal before completing.', []));
    }
    return { steps, missingDependencies: missing };
  } catch {
    return { steps: heuristicSteps(input), missingDependencies: missing };
  }
}

function extractJson(raw: string): Record<string, unknown> {
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a === -1 || b === -1) return {};
  try { return JSON.parse(raw.slice(a, b + 1)); } catch { return {}; }
}
