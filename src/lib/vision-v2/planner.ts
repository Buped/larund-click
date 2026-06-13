// Vision Mouse V2 — planner.
//
// The planner turns (goal + ScreenState + screenshot + last result) into ONE
// validated ActionPlan. It deliberately does NOT let the model guess pixels: it
// is given a structured element list with stable ids and told to choose an
// element_id / text / hotkey. Output is always run through the Phase 1
// validateActionPlan; on invalid JSON it does one repair retry, then signals a
// fallback to the legacy loop.

import type { ActionPlan, ScreenState, ActionResult, CliObservation } from './types';
import { validateActionPlan } from './plan-schema';
import { summarizeElements } from './screen-state';
import { shortcutHints } from './shortcuts';
import { callOpenRouterWithTools, type MessageContent } from '../openrouter';

export const VISION_V2_PLANNER_PROMPT = `
You are a HYBRID computer-use agent inside Larund Click, controlling a Windows
computer. You can use BOTH CLI commands and visual UI actions — they are
complementary tools in ONE loop, not separate modes. Never lock yourself into
only one modality. After EVERY action you re-observe the environment (CLI output
AND the screen) and choose the best next action. If a CLI command opens or
changes a GUI app (a browser, VS Code, any window), you MUST inspect the screen
(the ELEMENT LIST + screenshot below) before continuing — do not keep firing CLI
blind. If a visual interaction fails or is inefficient, consider a CLI/hotkey
alternative. You are NOT a mouse mover: guessing pixel coordinates is forbidden
whenever a structured target exists.

You receive each step: the user's goal, the result of your previous action, the
PREVIOUS CLI OUTPUT (if any), the active window, a clean screenshot, and a
STRUCTURED ELEMENT LIST. Each line carries precision metadata, e.g.:
  uia_42 [uia/ListItem] "Game name" bbox=[420,240,610,350] size=190x110 conf=0.72 precision=medium strategy=visual_refine large=false clickable=true

TARGET PRECISION (critical — this is how you click accurately):
- Avoid clicking large containers directly. A line with large=true, role
  Pane/Document/Group/List/DataGrid/Custom, or a big size= is a CONTAINER; clicking
  it lands in dead space or the wrong child (the classic 20–30px miss).
- Prefer smaller, more specific child elements (Button, ListItem, DataItem,
  Hyperlink, Edit) over containers, even if the container's text matches better.
- If the best target has precision=low/medium or strategy=visual_refine, prefer
  click_label/click_text (the executor will crop/refine to the exact spot) or pick
  a more specific child element. Do NOT emit raw_click for these.
- Only the most specific element that actually represents the thing you want.

Respond with EXACTLY ONE JSON object matching this ActionPlan schema, and nothing
else (no prose, no markdown, no code fences):
{
  "action": "cli_command|browser_open|hotkey|click_element|click_text|click_label|type_text|scroll|raw_click|wait|done|ask_user",
  "command": "<shell command for cli_command, e.g. 'code', 'npm run build', 'git status'>",
  "working_dir": "<optional cwd for cli_command>",
  "url": "<url for browser_open>",
  "target": { "element_id": "<id from the list>", "text": "<visible text>", "x": <int>, "y": <int> },
  "text": "<text to type, or text/label to click>",
  "keys": ["ctrl","shift","x"],
  "direction": "up|down|left|right",
  "clear_before_typing": false, "press_enter": false,
  "reason": "<why this moves toward the goal>",
  "confidence": 0.0-1.0,
  "expect": { "type": "text_appears|text_disappears|window_changed|panel_opened|focus_changed|url_changed|visual_change|none", "value": "<text>", "timeout_ms": 2500, "required": true }
}

CHOOSING A MODALITY (pick the most reliable tool for THIS step):
- cli_command — for launching apps, and file/git/npm/cargo/powershell/build/install
  work. Faster and more reliable than clicking through menus. After a cli_command
  that opens or changes a GUI, the NEXT step should observe the screen.
- browser_open — to open/navigate a URL in the agent's controllable browser so DOM
  actions work afterwards (prefer this over 'start chrome <url>' for web tasks).
- hotkey — a known, safe shortcut (see SHORTCUTS below).
- click_element / click_text / click_label — pick a target from the ELEMENT LIST
  (DOM/UIA), preferring element_id over text over coordinates.
- type_text — enter text (optionally after focusing a field).
- scroll.
- raw_click — ONLY as a last resort, with target.x/y, when NO element/text/label/
  hotkey/CLI path exists. Never guess x,y otherwise.

MODALITY SWITCHING:
- Switch CLI → visual when a CLI command opened/changed a GUI, the next step is a
  UI interaction, or you cannot verify state from CLI alone.
- Switch visual → CLI when file/build/install/git/npm/cargo/powershell work is
  needed, launching is faster from the shell, or a visual action keeps failing.
- Browser/DOM/UIA/hotkey are preferred over raw mouse.

RULES:
- Always include "reason", "confidence", and an "expect" verification.
- One action per response.
- For risky actions (delete, pay, buy, send, submit, password, destructive shell
  commands) use action "ask_user" with a clear question instead of acting.
- When you have verified the goal is achieved, use action "done" with a summary.
- If you genuinely cannot proceed and need info, use action "ask_user".
`.trim();

export interface PlannerContext {
  goal: string;
  state: ScreenState;
  lastResult?: ActionResult;
  /** Output of the most recent cli_command (the CLI half of HybridState). */
  cli?: CliObservation;
  retryContext?: string;
  modelId: string;
  userId: string;
  addCost: (usd: number) => void;
}

export type PlanV2Result =
  | { kind: 'plan'; plan: ActionPlan; raw: string }
  | { kind: 'fallback'; reason: string };

/** Extract the first balanced top-level JSON object from a string. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function buildUserContent(ctx: PlannerContext): MessageContent {
  const { state } = ctx;
  const hints = shortcutHints(state.active_window_title, state.active_app_name);
  const parts: string[] = [];
  parts.push(`GOAL: ${ctx.goal}`);
  parts.push(`ACTIVE WINDOW: "${state.active_window_title}" (app: ${state.active_app_name || 'unknown'})`);
  parts.push(`SCREEN: ${state.screen_width}x${state.screen_height}`);
  if (hints) parts.push(`SHORTCUTS (intent=keys): ${hints}`);
  parts.push(`ELEMENTS (${state.elements.length}):\n${summarizeElements(state.elements)}`);
  if (ctx.lastResult) {
    parts.push(
      `PREVIOUS ACTION: ${ctx.lastResult.action_executed} via ${ctx.lastResult.used_method} → ` +
      `${ctx.lastResult.success ? 'success' : 'FAILED'}${ctx.lastResult.error ? ` (${ctx.lastResult.error})` : ''}` +
      `${ctx.lastResult.verification ? `; verification ${ctx.lastResult.verification.verified ? 'passed' : 'FAILED'}` : ''}`,
    );
  }
  if (ctx.cli) {
    const clip = (s: string, n = 800) => (s.length > n ? `${s.slice(0, n)}…` : s);
    parts.push(
      `PREVIOUS CLI OUTPUT: $ ${ctx.cli.command}\n` +
      `exit=${ctx.cli.exitCode}\n` +
      (ctx.cli.stdout ? `stdout: ${clip(ctx.cli.stdout)}\n` : '') +
      (ctx.cli.stderr ? `stderr: ${clip(ctx.cli.stderr)}` : ''),
    );
  }
  if (ctx.retryContext) parts.push(`RETRY CONTEXT: ${ctx.retryContext}`);
  parts.push('Choose ONE ActionPlan JSON now.');

  const text = parts.join('\n\n');
  if (state.screenshot_base64) {
    return [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${state.screenshot_base64}` } },
    ] as MessageContent;
  }
  return text;
}

async function callPlannerOnce(
  messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[],
  ctx: PlannerContext,
): Promise<{ text: string; error?: string }> {
  let acc = '';
  let err: string | undefined;
  await callOpenRouterWithTools(
    messages,
    ctx.modelId,
    ctx.userId,
    (chunk) => { acc += chunk; },
    (usage) => { ctx.addCost(usage.costUsd); },
    (e) => { err = e; },
    false, // batch cost — the agent loop deducts once at the end
  );
  return { text: acc, error: err };
}

/** Produce one validated ActionPlan, or a fallback signal. */
export async function planV2(ctx: PlannerContext): Promise<PlanV2Result> {
  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    { role: 'system', content: VISION_V2_PLANNER_PROMPT },
    { role: 'user', content: buildUserContent(ctx) },
  ];

  const first = await callPlannerOnce(messages, ctx);
  if (first.error) return { kind: 'fallback', reason: `planner error: ${first.error}` };

  const json1 = extractJsonObject(first.text);
  if (json1) {
    try {
      const parsed = validateActionPlan(JSON.parse(json1));
      if (parsed.ok) return { kind: 'plan', plan: parsed.plan, raw: json1 };
      // fall through to repair with the validator's message
      messages.push({ role: 'assistant', content: first.text });
      messages.push({
        role: 'user',
        content: `Your ActionPlan was invalid: ${parsed.error}. Reply with ONLY one corrected ActionPlan JSON object.`,
      });
    } catch {
      messages.push({ role: 'assistant', content: first.text });
      messages.push({
        role: 'user',
        content: 'Your previous response was not valid JSON. Reply with ONLY one ActionPlan JSON object and nothing else.',
      });
    }
  } else {
    messages.push({ role: 'assistant', content: first.text });
    messages.push({
      role: 'user',
      content: 'No JSON object found. Reply with ONLY one ActionPlan JSON object and nothing else.',
    });
  }

  // One repair attempt.
  const second = await callPlannerOnce(messages, ctx);
  if (second.error) return { kind: 'fallback', reason: `planner repair error: ${second.error}` };
  const json2 = extractJsonObject(second.text);
  if (json2) {
    try {
      const parsed = validateActionPlan(JSON.parse(json2));
      if (parsed.ok) return { kind: 'plan', plan: parsed.plan, raw: json2 };
      return { kind: 'fallback', reason: `planner produced invalid ActionPlan twice: ${parsed.error}` };
    } catch {
      return { kind: 'fallback', reason: 'planner produced invalid JSON twice' };
    }
  }
  return { kind: 'fallback', reason: 'planner produced no JSON twice' };
}
