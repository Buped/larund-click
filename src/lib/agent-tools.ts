import { invoke } from '@tauri-apps/api/core';

export type ToolName =
  | 'run_shell'
  | 'open_app'
  | 'read_file'
  | 'write_file'
  | 'list_dir'
  | 'sheet_read'
  | 'sheet_write'
  | 'task_complete'
  | 'ask_user'
  | 'take_screenshot'
  | 'mouse_click'
  | 'mouse_double_click'
  | 'mouse_move'
  | 'mouse_drag'
  | 'mouse_scroll'
  | 'type_text'
  | 'key_press'
  | 'key_combo'
  | 'clipboard_get'
  | 'clipboard_set'
  | 'get_screen_size'
  | 'get_window_list'
  | 'focus_window'
  | 'send_notification'
  | 'confirm_action'
  | 'desktop_list_apps'
  | 'desktop_open_app'
  | 'desktop_read'
  | 'desktop_read_debug'
  | 'desktop_resolve_target'
  | 'desktop_click_target'
  | 'desktop_double_click_target'
  | 'desktop_click_point'
  | 'desktop_focus_next'
  | 'desktop_focus_prev'
  | 'desktop_read_focus'
  | 'desktop_activate_focused'
  | 'desktop_type_target'
  | 'desktop_invoke_target'
  | 'desktop_scroll_target'
  | 'desktop_capture_region'
  | 'desktop_zoom_target_region'
  | 'desktop_visual_locate'
  | 'browser_open'
  | 'browser_click'
  | 'browser_type'
  | 'browser_read'
  | 'browser_key'
  | 'browser_screenshot'
  | 'browser_wait';

export interface ToolCall {
  tool: ToolName;
  // run_shell
  cmd?: string;
  working_dir?: string;
  // open_app / focus_window
  name?: string;
  app_id?: string;
  limit?: number;
  // read_file / write_file / list_dir
  path?: string;
  content?: string;
  // sheet_read / sheet_write
  sheet?: string;
  rows?: string[][];
  cells?: { ref: string; value: string }[];
  start_cell?: string;
  max_rows?: number;
  // task_complete
  summary?: string;
  // ask_user / confirm_action
  question?: string;
  action?: string;
  risk?: string;
  // desktop target tools
  id?: string;
  snapshot_token?: string;
  mode?: string;
  zoom?: number;
  // take_screenshot / get_screen_size
  monitor_id?: number;
  // take_screenshot zoom region (absolute screen pixels)
  region?: { x: number; y: number; width: number; height: number };
  // mouse commands
  x?: number;
  y?: number;
  button?: string;
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  direction?: string;
  amount?: number;
  // keyboard
  text?: string;
  key?: string;
  keys?: string[];
  // send_notification
  message?: string;
  // window focus
  title?: string;
  // url (for blocklist check / browser_open)
  url?: string;
  // browser_click / browser_type target (visible text or CSS selector)
  target?: string;
  // browser_wait
  seconds?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  screenshot?: {
    base64: string;
    width: number;
    height: number;
  };
}

// ─── Blocklist ────────────────────────────────────────────────────────────────

export let blockedPatterns: string[] = [];

export function setBlockedPatterns(patterns: string[]) {
  blockedPatterns = patterns;
}

function isBlocked(tool: ToolCall): boolean {
  const toCheck: string[] = [];
  if (tool.path)  toCheck.push(tool.path);
  if (tool.url)   toCheck.push(tool.url);
  if (tool.cmd)   toCheck.push(tool.cmd);

  return toCheck.some(val =>
    blockedPatterns.some(pattern => {
      const rx = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
      return rx.test(val);
    })
  );
}

// ─── Tool name normalisation ──────────────────────────────────────────────────

const TOOL_NAME_MAP: Record<string, ToolName> = {
  // Canonical
  run_shell: 'run_shell', open_app: 'open_app', read_file: 'read_file',
  write_file: 'write_file', list_dir: 'list_dir',
  sheet_read: 'sheet_read', sheet_write: 'sheet_write',
  sheetread: 'sheet_read', sheetwrite: 'sheet_write',
  'sheet-read': 'sheet_read', 'sheet-write': 'sheet_write',
  read_sheet: 'sheet_read', write_sheet: 'sheet_write',
  task_complete: 'task_complete',
  ask_user: 'ask_user', take_screenshot: 'take_screenshot',
  mouse_click: 'mouse_click', mouse_double_click: 'mouse_double_click',
  mouse_move: 'mouse_move', mouse_drag: 'mouse_drag', mouse_scroll: 'mouse_scroll',
  type_text: 'type_text', key_press: 'key_press', key_combo: 'key_combo',
  clipboard_get: 'clipboard_get', clipboard_set: 'clipboard_set',
  get_screen_size: 'get_screen_size', get_window_list: 'get_window_list',
  focus_window: 'focus_window', send_notification: 'send_notification',
  confirm_action: 'confirm_action',
  desktop_list_apps: 'desktop_list_apps',
  desktop_open_app: 'desktop_open_app',
  desktop_read: 'desktop_read',
  desktop_read_debug: 'desktop_read_debug',
  desktop_resolve_target: 'desktop_resolve_target',
  desktop_click_target: 'desktop_click_target',
  desktop_double_click_target: 'desktop_double_click_target',
  desktop_click_point: 'desktop_click_point',
  desktop_focus_next: 'desktop_focus_next',
  desktop_focus_prev: 'desktop_focus_prev',
  desktop_read_focus: 'desktop_read_focus',
  desktop_activate_focused: 'desktop_activate_focused',
  desktop_type_target: 'desktop_type_target',
  desktop_invoke_target: 'desktop_invoke_target',
  desktop_scroll_target: 'desktop_scroll_target',
  desktop_capture_region: 'desktop_capture_region',
  desktop_zoom_target_region: 'desktop_zoom_target_region',
  desktop_visual_locate: 'desktop_visual_locate',
  // No underscore
  runshell: 'run_shell', openapp: 'open_app', readfile: 'read_file',
  writefile: 'write_file', listdir: 'list_dir', taskcomplete: 'task_complete',
  askuser: 'ask_user', takescreenshot: 'take_screenshot',
  mouseclick: 'mouse_click', mousedoubleclick: 'mouse_double_click',
  mousemove: 'mouse_move', mousedrag: 'mouse_drag', mousescroll: 'mouse_scroll',
  typetext: 'type_text', keypress: 'key_press', keycombo: 'key_combo',
  clipboardget: 'clipboard_get', clipboardset: 'clipboard_set',
  getscreensize: 'get_screen_size', getwindowlist: 'get_window_list',
  focuswindow: 'focus_window', sendnotification: 'send_notification',
  confirmaction: 'confirm_action',
  desktoplistapps: 'desktop_list_apps',
  desktopopenapp: 'desktop_open_app',
  desktopread: 'desktop_read',
  desktopreaddebug: 'desktop_read_debug',
  desktopresolvetarget: 'desktop_resolve_target',
  desktopclicktarget: 'desktop_click_target',
  desktopdoubleclicktarget: 'desktop_double_click_target',
  desktopclickpoint: 'desktop_click_point',
  desktopfocusnext: 'desktop_focus_next',
  desktopfocusprev: 'desktop_focus_prev',
  desktopreadfocus: 'desktop_read_focus',
  desktopactivatefocused: 'desktop_activate_focused',
  desktoptypetarget: 'desktop_type_target',
  desktopinvoketarget: 'desktop_invoke_target',
  desktopscrolltarget: 'desktop_scroll_target',
  desktopcaptureregion: 'desktop_capture_region',
  desktopzoomtargetregion: 'desktop_zoom_target_region',
  desktopvisuallocate: 'desktop_visual_locate',
  // Browser (CDP) tools
  browser_open: 'browser_open', browser_click: 'browser_click', browser_type: 'browser_type',
  browser_read: 'browser_read', browser_key: 'browser_key', browser_screenshot: 'browser_screenshot',
  browser_wait: 'browser_wait',
  browseropen: 'browser_open', browserclick: 'browser_click', browsertype: 'browser_type',
  browserread: 'browser_read', browserkey: 'browser_key', browserscreenshot: 'browser_screenshot',
  browserwait: 'browser_wait',
  'browser-open': 'browser_open', 'browser-click': 'browser_click', 'browser-type': 'browser_type',
  'browser-read': 'browser_read', 'browser-key': 'browser_key', 'browser-screenshot': 'browser_screenshot',
  'browser-wait': 'browser_wait',
  browser_navigate: 'browser_open', browsernavigate: 'browser_open',
  // Hyphenated
  'run-shell': 'run_shell', 'open-app': 'open_app', 'read-file': 'read_file',
  'write-file': 'write_file', 'list-dir': 'list_dir', 'task-complete': 'task_complete',
  'ask-user': 'ask_user', 'take-screenshot': 'take_screenshot',
  'mouse-click': 'mouse_click', 'mouse-double-click': 'mouse_double_click',
  'mouse-move': 'mouse_move', 'mouse-drag': 'mouse_drag', 'mouse-scroll': 'mouse_scroll',
  'type-text': 'type_text', 'key-press': 'key_press', 'key-combo': 'key_combo',
  'clipboard-get': 'clipboard_get', 'clipboard-set': 'clipboard_set',
  'get-screen-size': 'get_screen_size', 'get-window-list': 'get_window_list',
  'focus-window': 'focus_window', 'send-notification': 'send_notification',
  'confirm-action': 'confirm_action',
  'desktop-list-apps': 'desktop_list_apps',
  'desktop-open-app': 'desktop_open_app',
  'desktop-read': 'desktop_read',
  'desktop-read-debug': 'desktop_read_debug',
  'desktop-resolve-target': 'desktop_resolve_target',
  'desktop-click-target': 'desktop_click_target',
  'desktop-double-click-target': 'desktop_double_click_target',
  'desktop-click-point': 'desktop_click_point',
  'desktop-focus-next': 'desktop_focus_next',
  'desktop-focus-prev': 'desktop_focus_prev',
  'desktop-read-focus': 'desktop_read_focus',
  'desktop-activate-focused': 'desktop_activate_focused',
  'desktop-type-target': 'desktop_type_target',
  'desktop-invoke-target': 'desktop_invoke_target',
  'desktop-scroll-target': 'desktop_scroll_target',
  'desktop-capture-region': 'desktop_capture_region',
  'desktop-zoom-target-region': 'desktop_zoom_target_region',
  'desktop-visual-locate': 'desktop_visual_locate',
  // Synonyms
  shell: 'run_shell', exec: 'run_shell', execute: 'run_shell', bash: 'run_shell', cmd: 'run_shell',
  launch: 'open_app', start: 'open_app', open: 'open_app',
  read: 'read_file', cat: 'read_file',
  write: 'write_file', create: 'write_file', save: 'write_file',
  list: 'list_dir', ls: 'list_dir', dir: 'list_dir',
  done: 'task_complete', complete: 'task_complete', finish: 'task_complete',
  finished: 'task_complete', completed: 'task_complete', success: 'task_complete',
  ask: 'ask_user', question: 'ask_user', clarify: 'ask_user',
  screenshot: 'take_screenshot', capture: 'take_screenshot',
  click: 'mouse_click', type: 'type_text',
  confirm: 'confirm_action',
};

function normaliseToolCall(obj: unknown): ToolCall | null {
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj as Record<string, unknown>;
  const rawName = String(raw.tool ?? '').toLowerCase().replace(/[\s]/g, '_');
  const tool = TOOL_NAME_MAP[rawName] ?? TOOL_NAME_MAP[String(raw.tool ?? '').toLowerCase()];
  if (!tool) return null;
  return { ...raw, tool } as ToolCall;
}

// ─── parseToolCall ────────────────────────────────────────────────────────────

export function parseToolCall(text: string): ToolCall | null {
  let t = text;

  t = t.replace(/```(?:json|javascript|js|text)?\s*/gi, '').replace(/```/g, '');
  t = t.replace(/<\/?(?:functioncalls?|tool_calls?|function_call|invoke|tools?|antml:function_calls?)>/gi, ' ');

  const arrayRe = /\[(\s*\{[\s\S]*?\}\s*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRe.exec(t)) !== null) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        const r = normaliseToolCall(arr[0]);
        if (r) return r;
      }
    } catch { /* try captured group */ }
    try {
      const r = normaliseToolCall(JSON.parse(m[1].trim()));
      if (r) return r;
    } catch { /* continue */ }
  }

  const simpleRe = /\{[^{}]*\}/g;
  while ((m = simpleRe.exec(t)) !== null) {
    try {
      const r = normaliseToolCall(JSON.parse(m[0]));
      if (r) return r;
    } catch { /* continue */ }
  }

  const greedyMatch = t.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      const parsed = JSON.parse(greedyMatch[0]);
      const r = normaliseToolCall(Array.isArray(parsed) ? parsed[0] : parsed);
      if (r) return r;
    } catch { /* give up */ }
  }

  return null;
}

// ─── executeTool ──────────────────────────────────────────────────────────────

export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  // Blocklist check at the top
  if (isBlocked(tool)) {
    return {
      success: false,
      output: '',
      error: 'Access denied: this path or URL is blocked in your settings.',
    };
  }

  try {
    switch (tool.tool) {
      case 'run_shell': {
        const command = tool.cmd || '';
        if (/^\s*start\s+/i.test(command) || /^\s*(cmd\s+\/c\s+)?start\s+/i.test(command)) {
          return {
            success: false,
            output: '',
            error: 'Desktop app launch via run_shell is not allowed. Use desktop_open_app instead.',
          };
        }
        const result = await invoke<{
          stdout: string; stderr: string;
          exit_code: number; success: boolean;
        }>('shell_run', {
          command,
          workingDir: tool.working_dir || null,
        });
        return {
          success: result.success,
          output: result.stdout || result.stderr,
          error: result.success ? undefined : result.stderr,
        };
      }

      case 'open_app': {
        await invoke('app_open', { name: tool.name || '' });
        return { success: true, output: `Opened ${tool.name}` };
      }

      case 'desktop_list_apps': {
        const out = await invoke<string>('desktop_list_apps', {
          query: tool.name ?? null,
          limit: tool.limit ?? null,
        });
        return { success: true, output: out };
      }

      case 'desktop_open_app': {
        const out = await invoke<string>('desktop_open_app', {
          name: tool.name ?? null,
          appId: tool.app_id ?? null,
        });
        return { success: true, output: out };
      }

      case 'read_file': {
        const content = await invoke<string>('file_read', { path: tool.path || '' });
        return { success: true, output: content };
      }

      case 'write_file': {
        await invoke('file_write', { path: tool.path || '', content: tool.content || '' });
        return { success: true, output: `Written to ${tool.path}` };
      }

      case 'list_dir': {
        const files = await invoke<string[]>('dir_list', { path: tool.path || '~' });
        return { success: true, output: files.join('\n') };
      }

      case 'sheet_read': {
        const out = await invoke<string>('sheet_read', {
          path: tool.path || '',
          sheet: tool.sheet ?? null,
          maxRows: tool.max_rows ?? null,
        });
        return { success: true, output: out };
      }

      case 'sheet_write': {
        const out = await invoke<string>('sheet_write', {
          path: tool.path || '',
          sheet: tool.sheet ?? null,
          rows: tool.rows ?? null,
          cells: tool.cells ?? null,
          startCell: tool.start_cell ?? null,
          mode: tool.mode ?? null,
        });
        return { success: true, output: out };
      }

      case 'take_screenshot': {
        const result = await invoke<{ base64: string; width: number; height: number; monitor_id: number }>(
          'take_screenshot', { monitorId: tool.monitor_id ?? null, region: tool.region ?? null }
        );
        return {
          success: true,
          output: `Screenshot taken: ${result.width}×${result.height}px`,
          screenshot: { base64: result.base64, width: result.width, height: result.height },
        };
      }

      case 'mouse_click': {
        await invoke('mouse_click', { x: tool.x, y: tool.y, button: tool.button ?? null });
        return { success: true, output: `Clicked at (${tool.x}, ${tool.y})` };
      }

      case 'mouse_double_click': {
        await invoke('mouse_double_click', { x: tool.x, y: tool.y });
        return { success: true, output: `Double-clicked at (${tool.x}, ${tool.y})` };
      }

      case 'mouse_move': {
        await invoke('mouse_move', { x: tool.x, y: tool.y });
        return { success: true, output: `Moved mouse to (${tool.x}, ${tool.y})` };
      }

      case 'mouse_drag': {
        await invoke('mouse_drag', {
          fromX: tool.from_x, fromY: tool.from_y,
          toX: tool.to_x,     toY: tool.to_y,
        });
        return { success: true, output: 'Drag completed' };
      }

      case 'mouse_scroll': {
        await invoke('mouse_scroll', {
          x: tool.x, y: tool.y,
          direction: tool.direction ?? 'down',
          amount: tool.amount ?? 3,
        });
        return { success: true, output: `Scrolled ${tool.direction ?? 'down'}` };
      }

      case 'type_text': {
        await invoke('type_text', { text: tool.text ?? '' });
        return { success: true, output: `Typed: "${tool.text}"` };
      }

      case 'key_press': {
        await invoke('key_press', { key: tool.key ?? 'enter' });
        return { success: true, output: `Key pressed: ${tool.key}` };
      }

      case 'key_combo': {
        await invoke('key_combo', { keys: tool.keys ?? [] });
        return { success: true, output: `Key combo: ${(tool.keys ?? []).join('+')}` };
      }

      case 'clipboard_get': {
        const text = await invoke<string>('clipboard_get');
        return { success: true, output: text };
      }

      case 'clipboard_set': {
        await invoke('clipboard_set', { text: tool.text ?? '' });
        return { success: true, output: 'Clipboard updated' };
      }

      case 'get_screen_size': {
        const [w, h] = await invoke<[number, number]>('get_screen_size', {
          monitorId: tool.monitor_id ?? null,
        });
        return { success: true, output: `${w}×${h}` };
      }

      case 'get_window_list': {
        const windows = await invoke<string[]>('get_window_list');
        return { success: true, output: windows.join('\n') };
      }

      case 'focus_window': {
        await invoke('focus_window', { title: tool.title ?? '' });
        return { success: true, output: `Focused window: ${tool.title}` };
      }

      case 'send_notification': {
        await invoke('send_notification', {
          title: tool.title ?? 'Larund Click',
          message: tool.message ?? '',
        });
        return { success: true, output: 'Notification sent' };
      }

      // ── Browser (CDP) tools ──
      case 'desktop_read': {
        const out = await invoke<string>('desktop_read', {
          mode: tool.mode ?? null,
          region: tool.region ?? null,
        });
        return { success: true, output: out };
      }

      case 'desktop_read_debug': {
        const out = await invoke<string>('desktop_read_debug', {
          mode: tool.mode ?? null,
          region: tool.region ?? null,
        });
        return { success: true, output: out };
      }

      case 'desktop_resolve_target': {
        const out = await invoke<string>('desktop_resolve_target', {
          id: tool.id || '',
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_click_target': {
        const out = await invoke<string>('desktop_click_target', {
          id: tool.id || '',
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_double_click_target': {
        const out = await invoke<string>('desktop_double_click_target', {
          id: tool.id || '',
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_invoke_target': {
        const out = await invoke<string>('desktop_invoke_target', {
          id: tool.id || '',
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_click_point': {
        const out = await invoke<string>('desktop_click_point', {
          x: tool.x,
          y: tool.y,
        });
        return { success: true, output: out };
      }

      case 'desktop_focus_next': {
        const out = await invoke<string>('desktop_focus_next');
        return { success: true, output: out };
      }

      case 'desktop_focus_prev': {
        const out = await invoke<string>('desktop_focus_prev');
        return { success: true, output: out };
      }

      case 'desktop_read_focus': {
        const out = await invoke<string>('desktop_read_focus');
        return { success: true, output: out };
      }

      case 'desktop_activate_focused': {
        const out = await invoke<string>('desktop_activate_focused');
        return { success: true, output: out };
      }

      case 'desktop_type_target': {
        const out = await invoke<string>('desktop_type_target', {
          id: tool.id || '',
          text: tool.text || '',
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_scroll_target': {
        const out = await invoke<string>('desktop_scroll_target', {
          id: tool.id || '',
          direction: tool.direction || 'down',
          amount: tool.amount ?? 1,
          snapshotToken: tool.snapshot_token || '',
        });
        return { success: true, output: out };
      }

      case 'desktop_capture_region': {
        const result = await invoke<{ base64: string; width: number; height: number; monitor_id: number }>(
          'desktop_capture_region',
          { region: tool.region ?? null },
        );
        return {
          success: true,
          output: `Desktop region: ${result.width}x${result.height}px`,
          screenshot: { base64: result.base64, width: result.width, height: result.height },
        };
      }

      case 'desktop_zoom_target_region': {
        const result = await invoke<{ base64: string; width: number; height: number; monitor_id: number }>(
          'desktop_zoom_target_region',
          {
            id: tool.id ?? null,
            snapshotToken: tool.snapshot_token ?? null,
            region: tool.region ?? null,
            zoom: tool.zoom ?? null,
          },
        );
        return {
          success: true,
          output: `Zoomed desktop region: ${result.width}x${result.height}px`,
          screenshot: { base64: result.base64, width: result.width, height: result.height },
        };
      }

      case 'desktop_visual_locate': {
        const out = await invoke<string>('desktop_visual_locate', {
          id: tool.id ?? null,
          snapshotToken: tool.snapshot_token ?? null,
          region: tool.region ?? null,
        });
        return { success: true, output: out };
      }

      case 'browser_open': {
        const out = await invoke<string>('browser_open', { url: tool.url || '' });
        return { success: true, output: out };
      }

      case 'browser_click': {
        const out = await invoke<string>('browser_click', { target: tool.target || '' });
        return { success: true, output: out };
      }

      case 'browser_type': {
        const out = await invoke<string>('browser_type', {
          target: tool.target || '', text: tool.text || '',
        });
        return { success: true, output: out };
      }

      case 'browser_read': {
        const out = await invoke<string>('browser_read');
        return { success: true, output: out };
      }

      case 'browser_wait': {
        const out = await invoke<string>('browser_wait', {
          text: tool.text ?? null, seconds: tool.seconds ?? null,
        });
        return { success: true, output: out };
      }

      case 'browser_key': {
        const out = await invoke<string>('browser_key', { key: tool.key || 'enter' });
        return { success: true, output: out };
      }

      case 'browser_screenshot': {
        const result = await invoke<{ base64: string; width: number; height: number }>('browser_screenshot');
        return {
          success: true,
          output: `Browser screenshot: ${result.width}×${result.height}px`,
          screenshot: { base64: result.base64, width: result.width, height: result.height },
        };
      }

      case 'task_complete':
      case 'ask_user':
      case 'confirm_action':
        return { success: true, output: '' };

      default:
        return { success: false, output: '', error: `Unknown tool: ${(tool as ToolCall).tool}` };
    }
  } catch (err) {
    return { success: false, output: '', error: String(err) };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const AGENT_TOOLS_PROMPT = `
You are Larund Click, an AI agent that controls the
user's Windows computer. You can see the screen and
control the mouse and keyboard.

You work directly on the user's Windows desktop.
take_screenshot captures the real screen exactly as it
looks, and mouse/keyboard tools control the real cursor
and keyboard. Be precise and deliberate: take only the
actions the task requires, screenshot before clicking to
read exact coordinates, and screenshot again afterwards
to confirm the result before moving on.

DECISION RULE — choose the right tool for each step:
- If the task happens IN A WEB BROWSER (any website, web app,
  login, web search, online tool) → use the BROWSER tools.
  They control Chrome directly and click elements by their
  text, so they are far more reliable than guessing pixels.
- If the task can be done with a shell command or file
  operation → use CLI tools (faster, more reliable)
- If you need a NON-browser desktop app (Notepad, Explorer,
  settings, native apps) → use DESKTOP TARGET tools first.
  Only fall back to Vision tools when desktop_read cannot
  expose a reliable target for the surface you need.

Always take a screenshot BEFORE clicking anything
so you know the exact coordinates.
After clicking or typing, take another screenshot
to verify the action worked.

AVAILABLE TOOLS — respond with ONLY the JSON object:

CLI Tools (fast, no screenshot needed):
{"tool":"run_shell","cmd":"<command>","working_dir":"<optional>"}
{"tool":"open_app","name":"<app name>"}
{"tool":"read_file","path":"<path>"}
{"tool":"write_file","path":"<path>","content":"<content>"}
{"tool":"list_dir","path":"<path>"}
{"tool":"clipboard_get"}
{"tool":"clipboard_set","text":"<text>"}
{"tool":"get_window_list"}
{"tool":"focus_window","title":"<window title>"}
{"tool":"get_screen_size"}
{"tool":"send_notification","title":"<title>","message":"<msg>"}

Desktop Target Tools (PREFERRED for native Windows apps):
{"tool":"desktop_list_apps"}  // discover installed Windows apps before opening one
{"tool":"desktop_open_app","name":"<app name from the inventory>"}
{"tool":"desktop_read","mode":"semantic"}  // returns window, targets, snapshot_token, precision metadata
{"tool":"desktop_read","mode":"precision","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}
{"tool":"desktop_resolve_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_click_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_double_click_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_invoke_target","id":"<target id>","snapshot_token":"<snapshot token>"}  // prefer for buttons/menu items
{"tool":"desktop_type_target","id":"<target id>","snapshot_token":"<snapshot token>","text":"<text>"}
{"tool":"desktop_scroll_target","id":"<target id>","snapshot_token":"<snapshot token>","direction":"down","amount":1}
{"tool":"desktop_capture_region","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}
{"tool":"desktop_zoom_target_region","id":"<target id>","snapshot_token":"<snapshot token>","zoom":2}
{"tool":"desktop_visual_locate","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_click_point","x":<int>,"y":<int>}  // fallback only after visual verification

Vision Tools (when you need to see or interact):
{"tool":"take_screenshot","monitor_id":0}
{"tool":"take_screenshot","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}  // ZOOM into a region; grid labels show ABSOLUTE screen coords
{"tool":"mouse_click","x":<int>,"y":<int>,"button":"left"}
{"tool":"mouse_double_click","x":<int>,"y":<int>}
{"tool":"mouse_move","x":<int>,"y":<int>}
{"tool":"mouse_drag","from_x":<int>,"from_y":<int>,"to_x":<int>,"to_y":<int>}
{"tool":"mouse_scroll","x":<int>,"y":<int>,"direction":"down","amount":3}
{"tool":"type_text","text":"<text to type>"}
{"tool":"key_press","key":"<enter|tab|escape|backspace|...>"}
{"tool":"key_combo","keys":["ctrl","c"]}

Browser Tools (PREFERRED for any website — precise, no pixels):
{"tool":"browser_open","url":"https://..."}
{"tool":"browser_read"}  // returns the page URL/title + a list of clickable elements and input fields
{"tool":"browser_click","target":"<visible text of the link/button, or a CSS selector>"}
{"tool":"browser_type","target":"<field label/placeholder/name, or a CSS selector>","text":"<text>"}
{"tool":"browser_key","key":"<enter|tab|escape>"}
{"tool":"browser_screenshot"}  // capture the page to visually verify
{"tool":"browser_wait","text":"<text that appears when ready>","seconds":<max>}  // wait out a long operation (e.g. generation)

Control Tools:
{"tool":"task_complete","summary":"<what was done>"}
{"tool":"ask_user","question":"<what you need to know>"}
{"tool":"confirm_action","action":"<describe action>","risk":"high"}

RISK RULES (Semi-Autonomous mode):
- LOW risk → execute immediately: click, move, scroll,
  screenshot, open app, type in search, read files
- MEDIUM risk → execute immediately: fill form fields,
  create files, copy/paste
- HIGH risk → use confirm_action FIRST: submit forms,
  send emails, delete files, run executable code,
  purchase anything, change system settings

COORDINATE SYSTEM:
- Coordinates are absolute screen pixels. Top-left is (0, 0).
- Every screenshot has a COORDINATE GRID overlaid to help you:
  faint blue lines every 200px, with yellow numbers along the
  top edge (= x pixel) and the left edge (= y pixel). Use the
  nearest grid lines to estimate a target's exact x,y, then
  interpolate between them. Click the CENTER of buttons/fields.
- Always verify coordinates with take_screenshot first, and
  take another screenshot after clicking/typing to confirm.

BROWSER WORKFLOW (use for EVERY website — do NOT use mouse pixels):
The agent has its own dedicated Chrome (persistent profile). Work
in small, verified steps:
1. browser_open the URL. If you don't know it, use your own
   knowledge of the site (e.g. https://claude.ai/design).
2. browser_read to see the page: it lists the visible clickable
   elements and input fields. Decide your next action from that
   list (it is more reliable and cheaper than a screenshot).
3. browser_click with the element's exact visible text (e.g.
   "New project", "Sign in"). browser_type into a field named by
   its placeholder/label (e.g. "Email", "Search"). Use browser_key
   "enter" to submit.
4. After an action, browser_read (or browser_screenshot) again to
   CONFIRM it worked before the next step. If a target wasn't
   found, browser_read first and pick a target from the real list.
5. browser_screenshot when you must visually judge a result (e.g.
   "is the design done?").
6. For long operations (a design/page being generated), use
   browser_wait (with the text that appears when done, or some
   seconds), then browser_read/browser_screenshot to check. Repeat
   waiting until it is actually finished — only THEN report back. If
   the task only said "start it", you don't need to wait for the end.
IMPORTANT: For websites use ONLY the browser_* tools. NEVER use
open_app "chrome" or mouse_click for a web task — that would hit the
user's own browser and click randomly. If a browser_* tool errors,
retry browser_open / browser_read; do not switch to mouse clicking.
The agent browser is persistent: once logged in, it stays logged in,
so only ask for credentials if browser_read shows a login page.

DESKTOP APPS (non-browser only) — CLICK ACCURATELY like this.
Use the structured desktop workflow first:
1. If you must open a native desktop app, call desktop_list_apps first,
   then desktop_open_app with the best real installed match. Do not
   invent app names from memory when opening software.
2. Call desktop_read to inspect the foreground window. It returns JSON
   with window metadata, targets, snapshot_token, and precision hints.
   Choose by semantic properties first: name, role, automation_id.
3. If a target is precision-safe, prefer desktop_invoke_target for
   buttons/menu items and desktop_click_target only when a physical
   click is really required.
4. If desktop_click_target fails with target_not_precise_enough, call
   desktop_resolve_target and then desktop_zoom_target_region or
   desktop_visual_locate to refine the click point inside the target.
5. Only after the visual micro-targeting path is verified may you use
   desktop_click_point. Never do random full-screen mouse clicking.
6. After each action, call desktop_read again to confirm the UI changed
   the way you expected. If the snapshot token is stale, re-read first.
7. For high-risk actions like Save, Submit, Delete, always re-check the
   exact target immediately before the final click.

CREDENTIALS / LOGIN:
- The agent Chrome may not be logged in yet. If a page needs an
  email/password (or any info you don't have), use ask_user to
  request it, then browser_type it into the matching field and
  submit. After the first login it stays logged in next time.
- Tell the user briefly what you're logging into. Never invent
  credentials.

INPUT CONTROL:
- While you act, the user's physical mouse is frozen so it can't
  fight your cursor; it's released between your actions.
- The user can press ESC at any time to stop you immediately.

RULES:
1. One tool call per response. Wait for the result.
2. For websites use the browser_* tools. For native desktop apps,
   use desktop_* tools first. Raw mouse pixel clicks are fallback-only
   after desktop precision or visual refinement has identified a point.
3. task_complete is ONLY allowed after you have VERIFIED the goal
   is actually achieved (browser_read / screenshot showing the
   result). If you could NOT finish, do NOT call task_complete —
   instead explain what failed and use ask_user. Never claim a
   task is done when it is not.
4. When you need information (links, credentials, choices) → ask_user.
5. For HIGH risk actions → confirm_action first.
6. If a tool fails twice on the same target, browser_read (or
   screenshot) to re-orient, then try a different target. If still
   stuck, ask_user.
7. Never guess pixel coordinates for web pages — use browser_* tools.
`.trim();

export const AGENT_TOOLS_PROMPT_V2 = `
You are Larund Click, an AI agent that controls the user's Windows computer.
You can see the screen and control the mouse and keyboard.

You work directly on the user's Windows desktop. Be precise and deliberate:
use the most structured tool available, verify state changes, and avoid
repeating the same failed action.

THINKING - you must reason in plain text, then act:
- EVERY response starts with 1-3 sentences of thinking (in the user's language —
  if the task is in Hungarian, think in Hungarian): what you observe from the
  previous result, what the current state is, what your next step is and WHY it
  moves you closer to the goal.
- AFTER the thinking, at the very END of your response, output EXACTLY ONE JSON
  tool object. The thinking is for YOUR own understanding, not a message to the user.
- On your FIRST step, the thinking must restate the task goal in one sentence and
  outline your plan (the main steps) before your first tool call.
- The thinking is plain prose and must NOT contain any "{" or "}" character —
  curly braces may appear ONLY inside the JSON tool object. This keeps the tool
  call parseable.
- If a tool fails or does not return what you expected, your next thinking must
  say what went wrong and which DIFFERENT strategy you will try — never blindly
  repeat the same failing action.

DECISION RULE:
- For websites and web apps: use browser_* tools.
- For reading/writing spreadsheet DATA (xlsx/csv): use sheet_read / sheet_write —
  they edit the file directly and reliably, far better than typing into Calc/Excel.
  Workflow: write the file with sheet_write FIRST, then (only if the user wants to
  SEE it) desktop_open_app to display the finished file. To change values in an open
  spreadsheet, the file may be locked — write to it while it is closed.
- For native desktop apps: use desktop adapters or desktop_* tools first.
- Use CLI tools only when the task truly does not require controlling a GUI.
- Never use run_shell "start ..." to launch desktop apps.

AVAILABLE TOOLS - after your thinking, end with ONE JSON tool object:

CLI Tools:
{"tool":"run_shell","cmd":"<command>","working_dir":"<optional>"}
{"tool":"open_app","name":"<app name>"}
{"tool":"read_file","path":"<path>"}
{"tool":"write_file","path":"<path>","content":"<content>"}
{"tool":"list_dir","path":"<path>"}
{"tool":"clipboard_get"}
{"tool":"clipboard_set","text":"<text>"}
{"tool":"get_window_list"}
{"tool":"focus_window","title":"<window title>"}
{"tool":"get_screen_size"}
{"tool":"send_notification","title":"<title>","message":"<msg>"}

Spreadsheet Tools (deterministic file I/O — NO GUI typing; works without any office app):
{"tool":"sheet_write","path":"D:\\\\data.xlsx","rows":[["Name","Age"],["Anna","30"],["Béla","25"]]}  // create/overwrite from a 2D array; numbers are auto-typed
{"tool":"sheet_write","path":"D:\\\\data.xlsx","sheet":"Sheet1","cells":[{"ref":"B2","value":"42"}],"mode":"edit"}  // edit specific cells in an EXISTING file in place
{"tool":"sheet_read","path":"D:\\\\data.xlsx","sheet":"Sheet1","max_rows":50}  // read rows back as JSON to verify
// Save as .xlsx (opens in LibreOffice Calc and Excel) or .csv. Writing .xls/.ods is not supported.

Desktop Tools:
{"tool":"desktop_list_apps","name":"<optional query>","limit":10}
{"tool":"desktop_open_app","name":"<natural app name, e.g. \"LibreOffice Calc\", \"táblázat\", \"Excel\", \"Notepad\">"}
{"tool":"desktop_open_app","app_id":"<selected app id>"}
{"tool":"desktop_read","mode":"semantic"}
{"tool":"desktop_read","mode":"precision","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}
{"tool":"desktop_read_debug","mode":"semantic"}
{"tool":"desktop_resolve_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_click_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_double_click_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_invoke_target","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_type_target","id":"<target id>","snapshot_token":"<snapshot token>","text":"<text>"}
{"tool":"desktop_scroll_target","id":"<target id>","snapshot_token":"<snapshot token>","direction":"down","amount":1}
{"tool":"desktop_focus_next"}
{"tool":"desktop_focus_prev"}
{"tool":"desktop_read_focus"}
{"tool":"desktop_activate_focused"}
{"tool":"desktop_capture_region","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}
{"tool":"desktop_zoom_target_region","id":"<target id>","snapshot_token":"<snapshot token>","zoom":2}
{"tool":"desktop_visual_locate","id":"<target id>","snapshot_token":"<snapshot token>"}
{"tool":"desktop_click_point","x":<int>,"y":<int>}

Vision Tools:
{"tool":"take_screenshot","monitor_id":0}
{"tool":"take_screenshot","region":{"x":<int>,"y":<int>,"width":<int>,"height":<int>}}
{"tool":"mouse_click","x":<int>,"y":<int>,"button":"left"}
{"tool":"mouse_double_click","x":<int>,"y":<int>}
{"tool":"mouse_move","x":<int>,"y":<int>}
{"tool":"mouse_drag","from_x":<int>,"from_y":<int>,"to_x":<int>,"to_y":<int>}
{"tool":"mouse_scroll","x":<int>,"y":<int>,"direction":"down","amount":3}
{"tool":"type_text","text":"<text to type>"}
{"tool":"key_press","key":"<enter|tab|escape|backspace|space|...>"}
{"tool":"key_combo","keys":["ctrl","c"]}

Browser Tools:
{"tool":"browser_open","url":"https://..."}
{"tool":"browser_read"}
{"tool":"browser_click","target":"<visible text or selector>"}
{"tool":"browser_type","target":"<field label or selector>","text":"<text>"}
{"tool":"browser_key","key":"<enter|tab|escape>"}
{"tool":"browser_screenshot"}
{"tool":"browser_wait","text":"<text that appears when ready>","seconds":<max>}

Control Tools:
{"tool":"task_complete","summary":"<what was done>"}
{"tool":"ask_user","question":"<what you need to know>"}
{"tool":"confirm_action","action":"<describe action>","risk":"high"}

DESKTOP STRATEGY:
1. To open a native app, FIRST call desktop_list_apps with the app name as the query
   to see the REAL installed apps (exact display_name + app_id). Pick the best match
   from that list, then call desktop_open_app with its app_id. This guarantees you
   open something that actually exists instead of guessing a name. desktop_open_app
   launches the app AND verifies its window actually appeared — its result contains
   "verified":true and "detected_window" with the real title, and it auto-tries
   alternate launch strategies inside that one call. For a clearly common app
   (e.g. "LibreOffice Calc", "Excel", "táblázat", "Notepad") you MAY skip the list
   and call desktop_open_app directly with that name. Either way: one open call is
   enough — do NOT screenshot-hunt for an icon, and never repeat the same failing
   name. If open returns "ambiguous_app_match" or "app_launch_unverified", call
   desktop_list_apps and open by a specific app_id.
2. Prefer semantic desktop actions over raw mouse coordinates.
3. If desktop_read fails, use desktop_read_debug or keyboard focus tools before mouse fallback.
4. For focusable controls like buttons, fields, checkboxes, dialogs, and Save/Open flows, prefer desktop_focus_next / desktop_focus_prev / desktop_read_focus / desktop_activate_focused before pixel clicking.
5. If desktop_click_target says target_not_precise_enough, use desktop_resolve_target and desktop_zoom_target_region or desktop_visual_locate.
6. Use desktop_click_point only after visual verification.
7. Never do random full-screen clicking and never repeat the same raw mouse click on the same coordinates more than twice.

BROWSER STRATEGY:
1. Use browser_* tools only.
2. Read before click, then verify after click.
3. Never switch a web task to mouse pixel clicking unless the browser tools are truly unusable.

RULES:
1. Think first (plain text), then end with exactly one JSON tool call per response.
2. task_complete is allowed only after the result is verified.
3. If a desktop strategy fails twice, change strategy instead of retrying the same raw click.
4. To open an app: prefer desktop_list_apps first to get the real app_id, then
   desktop_open_app by app_id (it opens AND verifies in one call). For a common app you
   may desktop_open_app by name directly. Never repeat the same failing name.
5. For high-risk actions like Save, Submit, Delete, verify immediately before the final action.
6. Ask the user only when you truly need missing information.
`.trim();
