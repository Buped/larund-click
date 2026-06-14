import { invoke } from '@tauri-apps/api/core';
import type { ControlAction, ControlToolResult } from './types';
import { clickIntent, typeIntent } from './visual-controller';

export async function executeControlAction(
  action: ControlAction,
  ctx: { userId: string; addCost: (usd: number) => void; task: string },
): Promise<ControlToolResult> {
  switch (action.action) {
    case 'cli.run': {
      if (/^\s*(cmd\s+\/c\s+)?start\s+/i.test(action.cmd)) {
        return { success: false, output: '', error: 'desktop_app_launch_must_use_app_open' };
      }
      const result = await invoke<{ stdout: string; stderr: string; exit_code: number; success: boolean }>('shell_run', {
        command: action.cmd,
        workingDir: action.working_dir ?? null,
      });
      return { success: result.success, output: result.stdout || result.stderr, error: result.success ? undefined : result.stderr };
    }
    case 'file.read': {
      const content = await invoke<string>('file_read', { path: action.path });
      return { success: true, output: content };
    }
    case 'file.write': {
      await invoke('file_write', { path: action.path, content: action.content });
      return { success: true, output: `Written to ${action.path}` };
    }
    case 'file.list': {
      const files = await invoke<string[]>('dir_list', { path: action.path });
      return { success: true, output: files.join('\n') };
    }
    case 'sheet.read': {
      const output = await invoke<string>('sheet_read', {
        path: action.path,
        sheet: action.sheet ?? null,
        maxRows: action.max_rows ?? null,
      });
      return { success: true, output };
    }
    case 'sheet.write': {
      const output = await invoke<string>('sheet_write', {
        path: action.path,
        sheet: action.sheet ?? null,
        rows: action.rows ?? null,
        cells: null,
        startCell: action.start_cell ?? null,
        mode: action.mode ?? null,
      });
      return { success: true, output };
    }
    case 'clipboard.get': {
      const text = await invoke<string>('clipboard_get');
      return { success: true, output: text };
    }
    case 'clipboard.set': {
      await invoke('clipboard_set', { text: action.text });
      return { success: true, output: 'Clipboard set' };
    }
    case 'app.open': {
      const output = await invoke<string>('desktop_open_app', {
        name: action.name ?? null,
        appId: action.app_id ?? null,
      });
      return { success: true, output };
    }
    case 'window.list': {
      const titles = await invoke<string[]>('get_window_list');
      return { success: true, output: titles.join('\n') };
    }
    case 'window.focus': {
      await invoke('focus_window', { title: action.title });
      return { success: true, output: `Focused window: ${action.title}` };
    }
    case 'browser.open': {
      const output = await invoke<string>('browser_open', { url: action.url });
      return { success: true, output };
    }
    case 'browser.read': {
      const output = await invoke<string>('browser_read');
      return { success: true, output };
    }
    case 'browser.click': {
      try {
        const output = await invoke<string>('browser_click', { target: action.target });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'browser.type': {
      try {
        const output = await invoke<string>('browser_type', { target: action.target, text: action.text });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'browser.key': {
      try {
        const output = await invoke<string>('browser_key', { key: action.key });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'browser.wait': {
      const output = await invoke<string>('browser_wait', {
        text: action.text ?? null,
        seconds: action.seconds ?? null,
      });
      return { success: true, output };
    }
    case 'ui.read': {
      const output = await invoke<string>('desktop_read', { mode: action.mode ?? null });
      return { success: true, output };
    }
    case 'ui.invoke': {
      try {
        const output = await invoke<string>('desktop_invoke_target', { id: action.id, snapshotToken: action.snapshot_token });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'ui.click': {
      try {
        const output = await invoke<string>('desktop_click_target', { id: action.id, snapshotToken: action.snapshot_token });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'ui.type': {
      try {
        const output = await invoke<string>('desktop_type_target', { id: action.id, text: action.text, snapshotToken: action.snapshot_token });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'ui.scroll': {
      try {
        const output = await invoke<string>('desktop_scroll_target', {
          id: action.id,
          direction: action.direction,
          amount: action.amount ?? null,
          snapshotToken: action.snapshot_token,
        });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: '', error: String(err) };
      }
    }
    case 'ui.focusNext': {
      const output = await invoke<string>('desktop_focus_next');
      return { success: true, output };
    }
    case 'ui.activate': {
      const output = await invoke<string>('desktop_activate_focused');
      return { success: true, output };
    }
    case 'visual.clickIntent': {
      const result = await clickIntent({
        target: action.target,
        expected: action.expected,
        app: action.app,
        task: ctx.task,
        userId: ctx.userId,
        addCost: ctx.addCost,
      });
      return {
        success: result.success,
        output: result.success
          ? `visual_click_verified: ${result.target?.label}; ${result.verification?.reason}; debug=${result.debugDir}`
          : `visual_click_failed: ${result.error}; debug=${result.debugDir}`,
        error: result.success ? undefined : result.error,
        screenshot: result.after ? { base64: result.after.capture.base64, width: result.after.capture.width, height: result.after.capture.height } : undefined,
        details: { verification: result.verification, target: result.target, attempts: result.attempts, debugDir: result.debugDir },
      };
    }
    case 'visual.typeIntent': {
      const result = await typeIntent({
        target: action.target,
        text: action.text,
        expected: action.expected,
        app: action.app,
        task: ctx.task,
        userId: ctx.userId,
        addCost: ctx.addCost,
      });
      return {
        success: result.success,
        output: result.success
          ? `visual_type_verified: ${action.text}; ${result.verification?.reason}; debug=${result.debugDir}`
          : `visual_type_failed: ${result.error}; debug=${result.debugDir}`,
        error: result.success ? undefined : result.error,
        screenshot: result.after ? { base64: result.after.capture.base64, width: result.after.capture.width, height: result.after.capture.height } : undefined,
        details: { verification: result.verification, target: result.target, attempts: result.attempts, debugDir: result.debugDir },
      };
    }
    case 'keyboard.press': {
      await invoke('key_press', { key: action.key });
      return { success: true, output: `Key pressed: ${action.key}` };
    }
    case 'keyboard.combo': {
      await invoke('key_combo', { keys: action.keys });
      return { success: true, output: `Key combo: ${action.keys.join('+')}` };
    }
    case 'task.complete':
      return { success: true, output: action.summary };
    case 'ask_user':
      return { success: true, output: action.question };
    default:
      return { success: false, output: '', error: 'unknown_control_action' };
  }
}
