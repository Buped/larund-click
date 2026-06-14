import { invoke } from '@tauri-apps/api/core';
import type { ControlAction, ControlToolResult } from './types';
import type { ToolContext } from '../tools/types';
import type { DocumentReference } from '../references/types';
import { readDocument, readManyDocuments, summarizeReadResults, scanFolder, readRelevantFromFolder, formatFolderScan } from '../document-reader';

const ERR = (error: string): ControlToolResult => ({ success: false, output: '', error });

function refFromAction(
  ctx: ToolContext,
  input: { ref_id?: string; path?: string; url?: string; label?: string; kind?: string },
  fallbackKind: DocumentReference['kind'] = 'file',
): DocumentReference {
  const found = input.ref_id ? ctx.references?.find((ref) => ref.id === input.ref_id) : undefined;
  if (found) return found;
  const target = input.path ?? input.url ?? '';
  return {
    id: input.ref_id ?? `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: (input.kind as DocumentReference['kind'] | undefined) ?? (input.url ? 'url' : fallbackKind),
    label: input.label ?? target.split(/[\\/]/).filter(Boolean).pop() ?? target,
    path: input.path,
    url: input.url,
    source: 'user_reference',
  };
}

function docxPlaceholder(content: string): string {
  return [
    'DOCX generation scaffold',
    '',
    'This file was requested as .docx, but native OOXML packaging is not enabled in this build yet.',
    'The verified document content follows:',
    '',
    content,
  ].join('\n');
}

async function tryInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await invoke<T>(cmd, args);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Performs a single no-mouse action. This is a pure dispatcher: policy, approval
 * and audit gating happen in tools/run.ts before this is called. There is no
 * mouse / cursor / screenshot / visual case anywhere here, by design.
 */
export async function performControlAction(action: ControlAction, ctx: ToolContext): Promise<ControlToolResult> {
  switch (action.action) {
    // ── runtime ──────────────────────────────────────────────────────────
    case 'cli.run': {
      const r = await tryInvoke<{ stdout: string; stderr: string; exit_code: number; success: boolean }>('shell_run', {
        command: action.cmd, workingDir: action.working_dir ?? null,
      });
      if (!r.ok) return ERR(r.error);
      return { success: r.value.success, output: r.value.stdout || r.value.stderr, error: r.value.success ? undefined : r.value.stderr };
    }
    case 'process.start': {
      const r = await tryInvoke<string>('process_start', {
        command: action.cmd, workingDir: action.working_dir ?? null, background: action.background ?? true,
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'process.status': {
      const r = await tryInvoke<string>('process_status', { processId: action.process_id });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'process.kill': {
      const r = await tryInvoke<string>('process_kill', { processId: action.process_id });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    // ── files ────────────────────────────────────────────────────────────
    case 'file.read': {
      const r = await tryInvoke<string>('file_read', { path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.write': {
      const r = await tryInvoke<void>('file_write', { path: action.path, content: action.content });
      return r.ok ? { success: true, output: `Wrote ${action.path}` } : ERR(r.error);
    }
    case 'file.edit': {
      const read = await tryInvoke<string>('file_read', { path: action.path });
      if (!read.ok) return ERR(read.error);
      let next = read.value;
      if (typeof action.find === 'string') {
        if (!next.includes(action.find)) return ERR(`find text not present in ${action.path}`);
        next = next.split(action.find).join(action.replace ?? '');
      } else if (action.patch) {
        next = action.patch; // treat patch as full replacement content
      } else {
        return ERR('file.edit requires find/replace or patch');
      }
      const w = await tryInvoke<void>('file_write', { path: action.path, content: next });
      return w.ok ? { success: true, output: `Edited ${action.path}` } : ERR(w.error);
    }
    case 'file.list': {
      const r = await tryInvoke<string[]>('dir_list', { path: action.path });
      return r.ok ? { success: true, output: r.value.join('\n') } : ERR(r.error);
    }
    case 'file.mkdir': {
      const r = await tryInvoke<string>('fs_mkdir', { path: action.path, recursive: action.recursive ?? true });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.copy': {
      const r = await tryInvoke<string>('fs_copy', { from: action.from, to: action.to });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.move': {
      const r = await tryInvoke<string>('fs_move', { from: action.from, to: action.to });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.delete': {
      const r = await tryInvoke<string>('fs_delete', { path: action.path, recursive: action.recursive ?? false });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.search': {
      const r = await tryInvoke<string>('fs_search', { path: action.path, query: action.query, glob: action.glob ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.tree': {
      const r = await tryInvoke<string>('fs_tree', { path: action.path, depth: action.depth ?? 2 });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'file.exists': {
      const r = await tryInvoke<boolean>('fs_exists', { path: action.path });
      return r.ok ? { success: true, output: String(r.value) } : ERR(r.error);
    }
    case 'file.metadata': {
      const r = await tryInvoke<string>('fs_metadata', { path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    case 'document.read': {
      const ref = refFromAction(ctx, action);
      const result = await readDocument(ref);
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        error: result.ok ? undefined : result.error,
        details: { documentRead: result },
      };
    }
    case 'document.read_many': {
      const refs = (action.refs ?? []).map((ref) => refFromAction(ctx, ref));
      const results = await readManyDocuments(refs.length ? refs : (ctx.references ?? []).filter((ref) => ref.kind !== 'folder'));
      const ok = results.every((result) => result.ok);
      return {
        success: ok,
        output: summarizeReadResults(results),
        error: ok ? undefined : 'one_or_more_documents_failed',
        details: { documentReads: results },
      };
    }
    case 'folder.scan': {
      const ref = refFromAction(ctx, action, 'folder');
      const scan = await scanFolder(ref, { limits: { maxFolderEntries: action.max_entries, maxDepth: action.max_depth } });
      return {
        success: scan.ok,
        output: formatFolderScan(scan),
        error: scan.ok ? undefined : scan.error,
        details: { folderScan: scan },
      };
    }
    case 'folder.read_relevant': {
      const ref = refFromAction(ctx, action, 'folder');
      const result = await readRelevantFromFolder(ref, action.query ?? ctx.task, {
        limits: { maxFolderEntries: action.max_entries, maxDepth: action.max_depth },
      });
      const ok = result.scan.ok && result.documents.every((doc) => doc.ok);
      return {
        success: ok,
        output: `${formatFolderScan(result.scan)}\n\nRead documents:\n${summarizeReadResults(result.documents)}`,
        error: ok ? undefined : 'folder_relevant_read_failed',
        details: { folderScan: result.scan, documentReads: result.documents },
      };
    }
    case 'document.summarize': {
      const ref = refFromAction(ctx, action);
      const result = await readDocument(ref);
      return {
        success: result.ok,
        output: result.summary ?? result.contentText ?? '',
        error: result.ok ? undefined : result.error,
        details: { documentRead: result },
      };
    }

    // ── data ─────────────────────────────────────────────────────────────
    case 'sheet.read': {
      const r = await tryInvoke<string>('sheet_read', { path: action.path, sheet: action.sheet ?? null, maxRows: action.max_rows ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.write': {
      const r = await tryInvoke<string>('sheet_write', {
        path: action.path, sheet: action.sheet ?? null, rows: action.rows ?? null,
        cells: null, startCell: action.start_cell ?? null, mode: action.mode ?? null,
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.append': {
      const r = await tryInvoke<string>('sheet_write', {
        path: action.path, sheet: action.sheet ?? null, rows: action.rows,
        cells: null, startCell: null, mode: 'append',
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.export_csv': {
      const read = await tryInvoke<string>('sheet_read', { path: action.path, sheet: action.sheet ?? null, maxRows: null });
      if (!read.ok) return ERR(read.error);
      let rows: string[][] = [];
      try {
        const parsed = JSON.parse(read.value) as { rows?: string[][] };
        rows = parsed.rows ?? [];
      } catch {
        return ERR('sheet_export_csv_parse_failed');
      }
      const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const write = await tryInvoke<void>('file_write', { path: action.target_path, content: csv });
      return write.ok ? { success: true, output: `Exported ${rows.length} rows to ${action.target_path}` } : ERR(write.error);
    }
    case 'sheet.to_json': {
      const r = await tryInvoke<string>('sheet_read', { path: action.path, sheet: action.sheet ?? null, maxRows: action.max_rows ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    case 'doc.read': {
      const ref = refFromAction(ctx, { path: action.path, label: action.path }, 'file');
      const result = await readDocument(ref);
      return { success: result.ok, output: JSON.stringify(result, null, 2), error: result.ok ? undefined : result.error, details: { documentRead: result } };
    }
    case 'doc.write_txt': {
      const r = await tryInvoke<void>('file_write', { path: action.path, content: action.content });
      return r.ok ? { success: true, output: `Wrote text document ${action.path}` } : ERR(r.error);
    }
    case 'doc.write_docx': {
      const r = await tryInvoke<void>('file_write', { path: action.path, content: docxPlaceholder(action.content) });
      return r.ok
        ? { success: true, output: `Wrote DOCX scaffold ${action.path}. Native OOXML packaging is not enabled; content is preserved as text.` }
        : ERR(r.error);
    }

    // ── clipboard ──────────────────────────────────────────────────────────
    case 'clipboard.get': {
      const r = await tryInvoke<string>('clipboard_get');
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'clipboard.set': {
      const r = await tryInvoke<void>('clipboard_set', { text: action.text });
      return r.ok ? { success: true, output: 'Clipboard set' } : ERR(r.error);
    }

    // ── apps / windows / keyboard ──────────────────────────────────────────
    case 'app.open': {
      const r = await tryInvoke<string>('desktop_open_app', { name: action.name ?? action.uri ?? action.path ?? null, appId: action.app_id ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'window.list': {
      const r = await tryInvoke<string[]>('get_window_list');
      return r.ok ? { success: true, output: r.value.join('\n') } : ERR(r.error);
    }
    case 'window.focus': {
      const r = await tryInvoke<void>('focus_window', { title: action.title });
      return r.ok ? { success: true, output: `Focused: ${action.title}` } : ERR(r.error);
    }
    case 'keyboard.press': {
      const r = await tryInvoke<void>('key_press', { key: action.key });
      return r.ok ? { success: true, output: `Key: ${action.key}` } : ERR(r.error);
    }
    case 'keyboard.combo': {
      const r = await tryInvoke<void>('key_combo', { keys: action.keys });
      return r.ok ? { success: true, output: `Combo: ${action.keys.join('+')}` } : ERR(r.error);
    }

    // ── browser ────────────────────────────────────────────────────────────
    case 'browser.open': {
      const r = await tryInvoke<string>('browser_open', { url: action.url });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.read': {
      const r = await tryInvoke<string>('browser_read', { selector: action.selector ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.get_state': {
      const r = await tryInvoke<string>('browser_read', { selector: null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.click': {
      const r = await tryInvoke<string>('browser_click', { target: action.target });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.type': {
      const r = await tryInvoke<string>('browser_type', { target: action.target, text: action.text });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.key': {
      const r = await tryInvoke<string>('browser_key', { key: action.key });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.shortcut': {
      const r = await tryInvoke<string>('browser_shortcut', { keys: action.keys });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.paste': {
      // Optionally set the clipboard, then dispatch Ctrl+V into the focused field.
      if (typeof action.text === 'string') {
        const set = await tryInvoke<void>('clipboard_set', { text: action.text });
        if (!set.ok) return ERR(set.error);
      }
      const r = await tryInvoke<string>('browser_shortcut', { keys: ['ctrl', 'v'] });
      return r.ok ? { success: true, output: `Pasted${typeof action.text === 'string' ? ' clipboard TSV' : ''}: ${r.value}` } : ERR(r.error);
    }
    case 'browser.assert_text': {
      const r = await tryInvoke<string>('browser_read', { selector: null });
      if (!r.ok) return ERR(r.error);
      const present = r.value.toLowerCase().includes(action.text.toLowerCase());
      return present
        ? { success: true, output: `assert_text ok: "${action.text}" present` }
        : { success: false, output: r.value.slice(0, 400), error: `assert_text failed: "${action.text}" not found on page` };
    }
    case 'browser.assert_url': {
      const r = await tryInvoke<string>('browser_read', { selector: null });
      if (!r.ok) return ERR(r.error);
      const m = r.value.match(/^URL:\s*(.+)$/im);
      const url = m?.[1]?.trim() ?? '';
      const ok = url.toLowerCase().includes(action.url.toLowerCase());
      return ok
        ? { success: true, output: `assert_url ok: ${url}` }
        : { success: false, output: url, error: `assert_url failed: current "${url}" does not match "${action.url}"` };
    }
    case 'browser.wait': {
      const r = await tryInvoke<string>('browser_wait', { text: action.text ?? null, selector: action.selector ?? null, seconds: action.seconds ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.extract_table': {
      const r = await tryInvoke<string>('browser_extract_table', { selector: action.selector ?? null });
      // Fall back to a DOM read if the dedicated command is unavailable.
      if (!r.ok) {
        const read = await tryInvoke<string>('browser_read', { selector: action.selector ?? null });
        return read.ok ? { success: true, output: read.value } : ERR(r.error);
      }
      return { success: true, output: r.value };
    }
    case 'browser.download': {
      const r = await tryInvoke<string>('browser_download', { url: action.url ?? null, target: action.target ?? null, saveAs: action.save_as ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'browser.upload': {
      const r = await tryInvoke<string>('browser_upload', { target: action.target, path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    // ── connections / skills / workflows ───────────────────────────────────
    case 'connection.call': {
      if (!ctx.connections) return ERR('connections_unavailable');
      const r = await ctx.connections.call(action.connection, action.tool, action.args ?? {});
      return { success: r.success, output: r.output, error: r.error, details: r.details };
    }
    case 'skill.run': {
      if (!ctx.skills) return ERR('skills_unavailable');
      return ctx.skills.run(action.skill, action.input);
    }
    case 'workflow.start': {
      if (!ctx.workflows) return ERR('workflows_unavailable');
      return ctx.workflows.start(action.workflow, action.input);
    }
    case 'workflow.status': {
      if (!ctx.workflows) return ERR('workflows_unavailable');
      return ctx.workflows.status(action.workflow_id);
    }
    case 'workflow.cancel': {
      if (!ctx.workflows) return ERR('workflows_unavailable');
      return ctx.workflows.cancel(action.workflow_id);
    }

    // ── control flow ───────────────────────────────────────────────────────
    case 'approval.request':
      return { success: true, output: action.reason, approvalRequired: true, details: { proposed_action: action.proposed_action } };
    case 'task.complete':
      return { success: true, output: action.summary };
    case 'ask_user':
      return { success: true, output: action.question };

    default:
      return ERR('unknown_control_action');
  }
}
