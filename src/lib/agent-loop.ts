import { supabase } from './supabase';
import { callOpenRouterWithTools, type MessageContent } from './openrouter';
import { executeTool, parseToolCall, AGENT_TOOLS_PROMPT_V2 } from './agent-tools';
import { isVisionV2Enabled } from './vision-v2/config';
import { runVisionV2Turn, newV2Memory } from './vision-v2/run-v2';

export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'waiting_user'
  | 'complete'
  | 'error';

export type AutonomyMode = 'full' | 'semi' | 'manual';

export interface AgentStep {
  id: string;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error';
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  timestamp: string;
  screenshotBase64?: string; // Bug 2: carry screenshot data to UI
  details?: Record<string, unknown>;
}

export interface AgentLoopCallbacks {
  onStatus: (status: AgentStatus) => void;
  onStep: (step: AgentStep) => void;
  onAskUser: (question: string) => Promise<string>;
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
}

export interface AgentAbortSignal {
  aborted: boolean;
}

const MAX_ITERATIONS = 60;
const MAX_SAME_COORDINATE_CLICKS = 2;
const MAX_SAME_ERROR_RETRIES = 2;
type TaskMode = 'cli' | 'vision' | 'desktop';

function inferTaskMode(task: string): TaskMode {
  const t = task.toLowerCase();
  const desktopHints = [
    'libreoffice', 'calc', 'spreadsheet', 'excel', 'save dialog', 'save as',
    'desktop app', 'notepad', 'explorer', 'toolbar', 'checkbox', 'radio button',
    'window', 'dialog', 'asztal', 'alkalmaz', 'mentsd', 'táblázat', 'tablazat',
    'gomb', 'mező', 'mezo',
  ];
  const visualHints = [
    'click', 'kattint', 'mouse', 'cursor', 'screen', 'képerny',
    'browser', 'chrome', 'web', 'website', 'form', 'ui', 'visual',
    'desktop app', 'open app', 'window', 'ablak', 'scroll',
    'screenshot', 'képernyőkép', 'monitor',
    'böngész', 'oldal', 'weboldal', 'http', 'www', '.com', 'link',
    'claude.ai', 'design', 'bejelentkez', 'login', 'sign in',
  ];
  const cliHints = [
    'file', 'fájl', 'txt', 'text', 'szöveg', 'write', 'create', 'létrehoz',
    'read', 'olvas', 'save', 'ment', 'folder', 'mappa', 'dir', 'konzol',
    'terminal', 'shell', 'cmd', 'powershell', 'script',
  ];

  const desktopScore = desktopHints.filter(h => t.includes(h)).length;
  const visualScore = visualHints.filter(h => t.includes(h)).length;
  const cliScore = cliHints.filter(h => t.includes(h)).length;
  if (desktopScore >= Math.max(1, cliScore) && desktopScore >= visualScore) {
    return 'desktop';
  }
  return visualScore > cliScore ? 'vision' : 'cli';
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────

async function hideOverlay() {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const overlay = await WebviewWindow.getByLabel('overlay');
    if (overlay) await overlay.hide();
  } catch { /* silently skip */ }
}

async function updateOverlay(state: object) {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('agent-overlay-update', state);
  } catch { /* silently skip */ }
}

// ─── Main window helpers ──────────────────────────────────────────────────────
// On the real desktop the maximised chat window occludes every app the agent
// opens, so a screenshot would just capture Larund Click itself. Before the
// agent touches the screen we minimise the chat window (revealing the apps
// behind it) and restore it once the task is done or when the user is asked a
// question. Progress stays visible in the always-on-top overlay.

// These call custom Rust commands rather than the @tauri-apps/api window API,
// because window setters (minimize/unminimize/setFocus) require explicit
// capability permissions from a webview and would otherwise fail silently.
async function minimizeMainWindow(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('minimize_main_window');
  } catch (err) {
    console.warn('[WINDOW] minimize failed:', err);
  }
}

async function restoreMainWindow(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('restore_main_window');
  } catch (err) {
    console.warn('[WINDOW] restore failed:', err);
  }
}

// ─── Input guard helpers ──────────────────────────────────────────────────────
// Win32 low-level hooks (Rust side) that (a) stop the agent on a physical ESC
// even when the chat window is minimised, and (b) freeze the user's physical
// mouse/keyboard only while the AI is mid-action so the user can't fight it.
async function guardStart(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('input_guard_start');
  } catch (err) { console.warn('[GUARD] start failed:', err); }
}
async function guardStop(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('input_guard_stop');
  } catch { /* ignore */ }
}
async function guardSetBlock(on: boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('input_guard_set_block', { on });
  } catch { /* ignore */ }
}
async function guardPause(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('input_guard_pause');
  } catch { /* ignore */ }
}
async function guardAborted(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('input_guard_poll');
  } catch { return false; }
}

// ─── "Agent running" screen border ────────────────────────────────────────────
async function showAgentBorder(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_agent_border');
  } catch (err) { console.warn('[BORDER] show failed:', err); }
}
async function hideAgentBorder(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('hide_agent_border');
  } catch { /* ignore */ }
}

// ─── Context pruning ──────────────────────────────────────────────────────────
// Long visual tasks accumulate one screenshot per step. Keep the image only on
// the most recent `keep` user messages; replace older screenshots with a short
// text note so the context (and token cost) stays bounded.
function pruneOldScreenshots(
  messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[],
  keep = 2,
): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')) {
      seen++;
      if (seen > keep) {
        const textPart = m.content.find((c) => c.type === 'text') as
          | { type: 'text'; text: string }
          | undefined;
        m.content = `${textPart?.text ?? 'Tool result'} [korábbi képernyőkép elhagyva]`;
      }
    }
  }
}

function tryParseJson(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runAgentLoop(
  task: string,
  modelId: string,
  userId: string,
  callbacks: AgentLoopCallbacks,
  signal?: AgentAbortSignal,
  autonomyMode: AutonomyMode = 'semi',
): Promise<void> {
  const { onStatus, onStep, onAskUser, onComplete, onError } = callbacks;
  const taskMode = inferTaskMode(task);
  const isCliOnly = taskMode === 'cli';
  const taskLower = task.toLowerCase();
  const adapterHint = taskLower.includes('libreoffice') || taskLower.includes('calc') || taskLower.includes('spreadsheet') || taskLower.includes('excel') || taskLower.includes('táblázat') || taskLower.includes('tablazat')
    ? '\nADAPTER HINT: This looks like a spreadsheet workflow. To READ or WRITE spreadsheet DATA, prefer the deterministic sheet_write / sheet_read tools (they edit the .xlsx/.csv file directly — no GUI typing, no office app required) and write the file FIRST. Only if the user wants to SEE the result, open it with ONE desktop_open_app call naming the concrete program (e.g. "LibreOffice Calc", "Excel", or "táblázat") — it resolves the exact path, launches and verifies the window in a single call, so do not retry the same name or hunt for an icon. For Save / Open dialogs, prefer keyboard focus navigation and shortcuts such as Ctrl+S, Tab, Shift+Tab, Enter, and Space before raw mouse fallback.'
    : '';

  // Tools that touch the real screen. The first time the agent uses any of
  // them we minimise the chat window so it doesn't occlude the target apps.
  const screenTools = new Set([
    'take_screenshot',
    'mouse_click',
    'mouse_double_click',
    'mouse_move',
    'mouse_drag',
    'mouse_scroll',
    'type_text',
    'key_press',
    'key_combo',
    'desktop_open_app',
    'desktop_read',
    'desktop_read_debug',
    'desktop_resolve_target',
    'desktop_click_target',
    'desktop_double_click_target',
    'desktop_click_point',
    'desktop_focus_next',
    'desktop_focus_prev',
    'desktop_read_focus',
    'desktop_activate_focused',
    'desktop_invoke_target',
    'desktop_type_target',
    'desktop_scroll_target',
    'desktop_capture_region',
    'desktop_zoom_target_region',
    'desktop_visual_locate',
    'open_app',
    'focus_window',
  ]);

  // Tools that actually inject input — the physical mouse/keyboard is frozen
  // only around these, not during screenshots/thinking.
  const inputActionTools = new Set([
    'mouse_click',
    'mouse_double_click',
    'mouse_move',
    'mouse_drag',
    'mouse_scroll',
    'type_text',
    'key_press',
    'key_combo',
    'desktop_click_target',
    'desktop_double_click_target',
    'desktop_click_point',
    'desktop_focus_next',
    'desktop_focus_prev',
    'desktop_activate_focused',
    'desktop_invoke_target',
    'desktop_type_target',
    'desktop_scroll_target',
  ]);

  // Whether the agent has interacted with the screen, and whether the chat
  // window is currently minimised out of the way.
  let visionFlowActive = false;
  let mainMinimized = false;
  const ensureScreenClear = async () => {
    visionFlowActive = true;
    if (mainMinimized) return;
    mainMinimized = true;
    await minimizeMainWindow();
    // Arm the input guard (idempotent — also re-arms after an ask_user pause).
    await guardStart();
    // The chat window is now minimised, so inform the user with a toast that
    // the AI is in control and how to stop it (works regardless of minimise).
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('send_notification', {
        title: 'Larund Click',
        message: 'Az AI most a képernyőt vezérli — nyomj ESC-et a leállításhoz.',
      });
    } catch { /* notification optional */ }
    // Let the desktop repaint and the revealed apps come forward.
    await new Promise((r) => setTimeout(r, 600));
  };
  const restoreForUser = async () => {
    // Disarm the guard so the user can type the answer / use the mouse freely,
    // and ALWAYS bring the chat to the front (even in browser tasks, where it's
    // behind the agent browser) so the question is visible and answerable.
    await guardPause();
    mainMinimized = false;
    await restoreMainWindow();
  };

  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    {
      role: 'system',
      content: `${AGENT_TOOLS_PROMPT_V2}${adapterHint}\n\nTASK MODE HINT: ${taskMode.toUpperCase()}\nCLI tools (run_shell, open_app, read_file, write_file, list_dir) are available, but do not use them to fake native desktop control. Desktop tasks should prefer desktop_* tools, keyboard focus tools, and verified precision fallback. ${
        isCliOnly
          ? 'This task looks mostly CLI-solvable, so prefer CLI tools unless the task explicitly requires a GUI.'
          : taskMode === 'desktop'
            ? 'This task is a native desktop workflow. Prefer desktop semantic read, keyboard focus navigation, and verified desktop precision. Avoid raw mouse fallback until the structured paths fail.'
            : 'This task likely needs a visual workflow: use browser_* for web pages and verified desktop tools for native apps.'
      }`,
    },
    { role: 'user', content: task },
  ];

  // Screenshot buffer — keeps up to 3 most-recent screenshots for vision context
  const screenshotBuffer: Array<{ base64: string; width: number; height: number }> = [];
  const MAX_SCREENSHOTS = 3;

  // Accumulated steps for overlay
  const steps: AgentStep[] = [];

  const emitStep = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
  };

  // Like emitStep, but if a step with the same id already exists it is replaced
  // in place (used to stream the live "thinking" text token-by-token into a
  // single step). onStep also upserts on the frontend by id.
  const upsertStep = (step: AgentStep) => {
    const idx = steps.findIndex((s) => s.id === step.id);
    if (idx >= 0) steps[idx] = step;
    else steps.push(step);
    onStep(step);
  };

  const modeStep: AgentStep = {
    id: `step-${Date.now()}-mode`,
    type: 'thinking',
    output: taskMode === 'cli'
      ? 'Feladat módja: CLI-first. GUI csak akkor, ha tényleg szükséges.'
      : taskMode === 'desktop'
        ? 'Feladat módja: desktop-first. Strukturált desktop, fókusz és precision fallback engedélyezve.'
        : 'Feladat módja: vision-first. Vizuális eszközök engedélyezve.',
    timestamp: new Date().toISOString(),
  };
  emitStep(modeStep);
  await updateOverlay({ active: true, status: 'planning', task, steps });

  // The agent works directly on the user's desktop: screenshots capture the
  // real screen and mouse/keyboard map to the real cursor. Cleanup hides the
  // overlay and brings the chat window back if we minimised it for vision work.
  const cleanup = async () => {
    await guardStop();
    if (unlistenAbort) { unlistenAbort(); unlistenAbort = null; }
    await hideAgentBorder();
    await hideOverlay();
    if (visionFlowActive) await restoreMainWindow();
  };

  // Listen for a physical-ESC abort emitted by the Rust input guard so we can
  // stop even mid-stream (works while the chat window is minimised).
  let unlistenAbort: (() => void) | null = null;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlistenAbort = await listen('agent-input-abort', () => {
      if (signal) signal.aborted = true;
    });
  } catch { /* event listener optional */ }

  // Aborted if the user clicked Stop OR pressed the physical ESC.
  const isAborted = async (): Promise<boolean> => {
    if (signal?.aborted) return true;
    if (await guardAborted()) {
      if (signal) signal.aborted = true;
      return true;
    }
    return false;
  };

  onStatus('planning');
  await showAgentBorder();
  await updateOverlay({ active: true, status: 'planning', task, steps });

  let iterations = 0;
  let totalCostUsd = 0;
  let lastCoordinateKey = '';
  let sameCoordinateClicks = 0;
  let lastErrorSignature = '';
  let sameErrorRetries = 0;

  // ── Vision Mouse V2 wiring ──────────────────────────────────────────────────
  // Resolve the flag once. When ON, each iteration runs the element-first V2
  // pipeline (ScreenState → ActionPlan → executor → verify); on a V2 fallback the
  // iteration drops through to the unchanged legacy path. When OFF, behaviour is
  // byte-identical to before.
  const visionV2Enabled = isVisionV2Enabled();
  const v2Mem = newV2Memory();
  const webHint = /https?:|www\.|\.com|\.io|\.org|browser|böngész|chrome|claude\.ai|weboldal|website|\boldal\b/.test(taskLower);

  while (iterations < MAX_ITERATIONS) {
    if (await isAborted()) {
      onError('Task stopped by user.');
      await cleanup();
      return;
    }

    iterations++;

    // ── V2 branch: one element-first turn, or fall through to legacy ──
    if (visionV2Enabled) {
      onStatus('executing');
      await updateOverlay({ active: true, status: 'executing', task, steps });
      let turn: Awaited<ReturnType<typeof runVisionV2Turn>>;
      try {
        turn = await runVisionV2Turn({
          task, modelId, userId, webHint, autonomyMode, mem: v2Mem,
          addCost: (usd) => { totalCostUsd += usd; },
          emitStep, ensureScreenClear, restoreForUser, guardSetBlock, isAborted, onAskUser,
        });
      } catch (err) {
        turn = { kind: 'fallback_legacy', reason: String(err) };
      }
      if (turn.kind === 'aborted') {
        onError('Task stopped by user.');
        await cleanup();
        return;
      }
      if (turn.kind === 'complete') {
        onStatus('complete');
        await _finalDeduct(userId, totalCostUsd);
        emitStep({
          id: `step-${Date.now()}-v2done`, type: 'complete',
          output: turn.summary, timestamp: new Date().toISOString(), details: { branch: 'v2' },
        });
        await updateOverlay({ active: false, status: 'complete', task, steps });
        await cleanup();
        onComplete(turn.summary);
        return;
      }
      if (turn.kind === 'continue') {
        continue;
      }
      // fallback_legacy → mark it and let this iteration run the legacy path.
      emitStep({
        id: `step-${Date.now()}-v2fb`, type: 'thinking',
        output: `Vision V2 fell back to legacy this step: ${turn.reason}`,
        timestamp: new Date().toISOString(), details: { branch: 'legacy', fallbackFrom: 'v2' },
      });
    }

    let aiResponse = '';
    // Bug 1: track whether the streaming call itself reported an error
    let streamError = false;

    // Live "thinking" streaming: the model writes plain-prose reasoning, then
    // ends with the JSON tool object. Everything before the first "{" is the
    // reasoning; we stream it token-by-token into one upserted thinking step.
    let jsonStarted = false;
    let lastThinkingEmitted = '';
    let streamedThinking = false;
    const thinkStepId = `step-${Date.now()}-think`;

    onStatus('executing');
    await updateOverlay({ active: true, status: 'executing', task, steps });

    // Keep only the most recent screenshots in context to bound token cost.
    pruneOldScreenshots(messages);

    await callOpenRouterWithTools(
      messages,
      modelId,
      userId,
      (chunk) => {
        aiResponse += chunk;
        if (jsonStarted) return;
        const brace = aiResponse.indexOf('{');
        if (brace !== -1) jsonStarted = true;
        const thinking = (brace === -1 ? aiResponse : aiResponse.slice(0, brace)).trim();
        if (thinking && thinking !== lastThinkingEmitted) {
          lastThinkingEmitted = thinking;
          streamedThinking = true;
          upsertStep({
            id: thinkStepId,
            type: 'thinking',
            output: thinking,
            timestamp: new Date().toISOString(),
            details: { phase: 'reasoning' },
          });
        }
      },
      (usage) => { totalCostUsd += usage.costUsd; },
      (err) => {
        streamError = true;
        onError(err);
      },
      false,
    );
    if (streamedThinking) {
      await updateOverlay({ active: true, status: 'executing', task, steps });
    }

    // Bug 1: if the streaming call reported an error, stop the loop cleanly
    if (streamError) {
      await cleanup();
      return;
    }

    // Bug 1: debug logging — shows what the AI returned and whether parsing succeeded
    console.log('[AGENT LOOP] Raw AI response:', JSON.stringify(aiResponse.slice(0, 500)));
    console.log('[AGENT LOOP] parseToolCall result:', JSON.stringify(parseToolCall(aiResponse)));

    if (!aiResponse.trim()) {
      onError('Empty response from AI');
      await cleanup();
      return;
    }

    const toolCall = parseToolCall(aiResponse);

    if (!toolCall) {
      // If the model clearly attempted a tool call but the JSON was malformed,
      // ask it to retry with clean JSON instead of ending the task here.
      if (/["']tool["']\s*:/.test(aiResponse)) {
        onStep({
          id: `step-${Date.now()}`,
          type: 'thinking',
          output: 'Hibás eszközhívás formátum — újrapróbálom.',
          timestamp: new Date().toISOString(),
        });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content:
            'Your previous response could not be parsed. Respond with ONLY one valid JSON tool object and nothing else, e.g. {"tool":"take_screenshot"} or {"tool":"mouse_click","x":100,"y":200,"button":"left"}.',
        });
        continue;
      }
      // Plain text response — AI considers itself done. The reasoning text was
      // already streamed live as the thinking step (no "{" was ever seen), so we
      // don't emit a duplicate one here.
      if (!streamedThinking) {
        onStep({
          id: `step-${Date.now()}`,
          type: 'thinking',
          output: aiResponse,
          timestamp: new Date().toISOString(),
        });
      }
      messages.push({ role: 'assistant', content: aiResponse });
      onStatus('complete');
      await _finalDeduct(userId, totalCostUsd);
      await cleanup();
      onComplete(aiResponse);
      return;
    }

    const stepId = `step-${Date.now()}`;
    const toolCallStep: AgentStep = {
      id: stepId,
      type: 'tool_call',
      tool: toolCall.tool,
      input: JSON.stringify(toolCall, null, 2),
      timestamp: new Date().toISOString(),
    };

    steps.push(toolCallStep);
    onStep(toolCallStep);
    await updateOverlay({ active: true, status: 'executing', task, steps });

    // ── task_complete ──
    if (toolCall.tool === 'task_complete') {
      onStatus('complete');
      await _finalDeduct(userId, totalCostUsd);
      const completeStep: AgentStep = {
        id: `step-${Date.now()}`,
        type: 'complete',
        output: toolCall.summary || 'Task completed.',
        timestamp: new Date().toISOString(),
      };
      steps.push(completeStep);
      onStep(completeStep);
      await updateOverlay({ active: false, status: 'complete', task, steps });
      await cleanup();
      onComplete(toolCall.summary || 'Task completed.');
      return;
    }

    // ── ask_user ──
    if (toolCall.tool === 'ask_user') {
      onStatus('waiting_user');
      await restoreForUser();
      await updateOverlay({
        active: true, status: 'waiting_user', task, steps,
        askQuestion: toolCall.question || 'What should I do?',
      });
      const answer = await onAskUser(toolCall.question || 'What should I do?');
      if (signal?.aborted) {
        onError('Task stopped by user.');
        await cleanup();
        return;
      }
      onStatus('executing');
      await updateOverlay({ active: true, status: 'executing', task, steps });
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `User answered: ${answer}` });
      continue;
    }

    // ── confirm_action ──
    if (toolCall.tool === 'confirm_action') {
      onStatus('waiting_user');
      await restoreForUser();
      const question = `⚠️ Confirm action:\n"${toolCall.action}"\n\nShould I proceed?`;
      await updateOverlay({
        active: true, status: 'waiting_user', task, steps,
        askQuestion: question,
      });
      const answer = await onAskUser(question);
      if (signal?.aborted) {
        onError('Task stopped by user.');
        await cleanup();
        return;
      }
      onStatus('executing');
      await updateOverlay({ active: true, status: 'executing', task, steps });
      const approved = answer.toLowerCase().includes('yes')
        || answer.toLowerCase().includes('ok')
        || answer.toLowerCase().includes('proceed');
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({
        role: 'user',
        content: approved
          ? 'User approved. Proceed with the action.'
          : 'User declined. Do not perform this action. Ask what to do instead.',
      });
      continue;
    }

    // ── manual autonomy mode: intercept input-generating tools ──
    if (autonomyMode === 'manual' &&
        ['mouse_click', 'mouse_double_click', 'type_text', 'key_press', 'key_combo'].includes(toolCall.tool)) {
      onStatus('waiting_user');
      await restoreForUser();
      const question = `Manual mode: confirm action?\n${toolCall.tool}${toolCall.x != null ? ` at (${toolCall.x},${toolCall.y})` : ''}${toolCall.text ? ` — "${toolCall.text}"` : ''}${toolCall.key ? ` — "${toolCall.key}"` : ''}`;
      await updateOverlay({
        active: true, status: 'waiting_user', task, steps,
        askQuestion: question,
      });
      const answer = await onAskUser(question);
      if (signal?.aborted) {
        onError('Task stopped by user.');
        await cleanup();
        return;
      }
      onStatus('executing');
      await updateOverlay({ active: true, status: 'executing', task, steps });
      const approved = answer.toLowerCase().includes('yes')
        || answer.toLowerCase().includes('ok')
        || answer.toLowerCase().includes('proceed');
      if (!approved) {
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({ role: 'user', content: 'User declined this action. Ask what to do instead.' });
        continue;
      }
    }

    // ── execute tool ──
    // Before anything that touches the screen, minimise the chat window so it
    // doesn't occlude the apps the agent needs to see/control.
    const coordinateKey =
      toolCall.tool === 'mouse_click' || toolCall.tool === 'mouse_double_click' || toolCall.tool === 'desktop_click_point'
        ? `${toolCall.tool}:${toolCall.x ?? ''}:${toolCall.y ?? ''}`
        : '';
    if (coordinateKey) {
      sameCoordinateClicks = coordinateKey === lastCoordinateKey ? sameCoordinateClicks + 1 : 1;
      lastCoordinateKey = coordinateKey;
      if (sameCoordinateClicks > MAX_SAME_COORDINATE_CLICKS) {
        const warning = 'stalled_same_coordinate: repeated raw click on the same coordinates. Change strategy to desktop_read, keyboard focus, or visual refinement instead.';
        const guardStep: AgentStep = {
          id: `${stepId}-guard`,
          type: 'error',
          tool: toolCall.tool,
          error: warning,
          timestamp: new Date().toISOString(),
          details: {
            strategy_path: 'raw_mouse',
            stalled_on_same_point: true,
            retry_count: sameCoordinateClicks,
          },
        };
        steps.push(guardStep);
        onStep(guardStep);
        await updateOverlay({ active: true, status: 'executing', task, steps });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({ role: 'user', content: `Tool error: ${warning}` });
        continue;
      }
    } else {
      sameCoordinateClicks = 0;
      lastCoordinateKey = '';
    }

    if (screenTools.has(toolCall.tool)) {
      await ensureScreenClear();
    }

    // Freeze the user's physical mouse/keyboard only for the duration of an
    // actual input action, then immediately release it.
    const isInputAction = inputActionTools.has(toolCall.tool);
    if (isInputAction) await guardSetBlock(true);
    let result;
    try {
      result = await executeTool(toolCall);
    } finally {
      if (isInputAction) await guardSetBlock(false);
    }

    // Give a freshly launched GUI app time to open before the next screenshot.
    if (toolCall.tool === 'open_app' && result.success) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Add screenshot to buffer if tool returned one
    if (result.screenshot) {
      screenshotBuffer.push(result.screenshot);
      if (screenshotBuffer.length > MAX_SCREENSHOTS) {
        screenshotBuffer.shift();
      }
    }

    const parsedResult = tryParseJson(result.output);
    const resultDetails: Record<string, unknown> = {};
    if (parsedResult) {
      Object.assign(resultDetails, parsedResult);
    }
    let injectedStrategyHint = false;
    if (result.error) {
      const errorSignature = `${toolCall.tool}:${result.error}`;
      sameErrorRetries = errorSignature === lastErrorSignature ? sameErrorRetries + 1 : 1;
      lastErrorSignature = errorSignature;
      if (result.error.startsWith('ambiguous_app_match:')) {
        const candidateJson = result.error.slice('ambiguous_app_match:'.length);
        try {
          resultDetails.app_match_candidates = JSON.parse(candidateJson);
        } catch {
          resultDetails.app_match_candidates = candidateJson;
        }
      }
      resultDetails.desktop_read_failure_stage =
        result.error.includes('Failed to parse desktop UI snapshot') || result.error.includes('desktop_read')
          ? 'semantic_desktop_parse_failed'
          : result.error.includes('ambiguous_app_match')
            ? 'app_match_ambiguous'
            : result.error.includes('target_not_precise_enough')
              ? 'visual_precision_not_verified'
            : undefined;
      resultDetails.retry_count = sameErrorRetries;
      if (toolCall.tool === 'desktop_read' && resultDetails.desktop_read_failure_stage === 'semantic_desktop_parse_failed') {
        injectedStrategyHint = true;
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `Tool error: ${result.error}\nDo not fall back to raw mouse clicks yet. Try desktop_read_debug first, then keyboard focus tools (desktop_read_focus / desktop_focus_next / desktop_activate_focused) before any raw mouse fallback.`,
        });
      }
      if (sameErrorRetries > MAX_SAME_ERROR_RETRIES) {
        injectedStrategyHint = true;
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `Tool error: ${result.error}\nChange strategy now. Do not retry the same failing tool path again. Prefer desktop_read_debug, keyboard focus tools, or a different desktop strategy.`,
        });
      }
    } else {
      sameErrorRetries = 0;
      lastErrorSignature = '';
    }

    // Bug 2: attach screenshot base64 to the step so chat.tsx can render it
    const resultStep: AgentStep = {
      id: `${stepId}-result`,
      type: 'tool_result',
      tool: toolCall.tool,
      output: result.output,
      error: result.error,
      timestamp: new Date().toISOString(),
      screenshotBase64: result.screenshot?.base64,
      details: Object.keys(resultDetails).length > 0 ? resultDetails : undefined,
    };
    steps.push(resultStep);
    onStep(resultStep);
    await updateOverlay({ active: true, status: 'executing', task, steps });

    if (!injectedStrategyHint) {
      messages.push({ role: 'assistant', content: aiResponse });
    }

    // Include screenshot as vision context in the next message
    const lastScreenshot = screenshotBuffer[screenshotBuffer.length - 1];
    if (result.screenshot && lastScreenshot) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: result.success
              ? `Tool result: ${result.output}`
              : `Tool error: ${result.error}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${lastScreenshot.base64}`,
            },
          },
        ] as MessageContent,
      });
    } else {
      messages.push({
        role: 'user',
        content: result.success
          ? `Tool result: ${result.output || 'Success (no output)'}`
          : `Tool error: ${result.error}`,
      });
    }
  }

  await _finalDeduct(userId, totalCostUsd);
  await cleanup();
  onError(`Reached maximum iterations (${MAX_ITERATIONS})`);
}

async function _finalDeduct(userId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  try {
    await supabase.rpc('deduct_uc_credits', {
      p_user_id: userId,
      p_cost_usd: costUsd,
    });
  } catch (e) {
    console.warn('Agent credit deduction failed:', e);
  }
}
