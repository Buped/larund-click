import { invoke } from '@tauri-apps/api/core';
import type { ControlAction, ControlToolResult } from './types';
import type { ToolContext } from '../tools/types';
import type { DocumentReference } from '../references/types';
import { readDocument, readManyDocuments, summarizeReadResults, scanFolder, readRelevantFromFolder, formatFolderScan } from '../document-reader';
import { getCredentialForDomain, getCredential, resolveCredentialPassword, markCredentialUsed, normalizeDomain } from '../credentials/store';
import { getApp, markAppUsed } from '../apps/store';
import { getBrowserProfile, DEFAULT_BROWSER_PROFILE } from '../browser/profiles';
import { planArtifact } from '../artifacts/planner';
import { executeCode, installPackageAction } from '../code-exec/execute';
import { lintPresentation } from '../artifacts/presentation/quality-lint';
import type { EmailDraft } from '../email/types';
import { newEmailDraftId, gmailDraftUrl, toSourceChips } from '../email/compose';
import type { SectionSummarizer } from '../document-reader';
import { callOpenRouterJson } from '../openrouter';
import { MODELS } from '../../constants/models';
import { extractContactInfo, extractPage, webBatchSearch, webSearch } from '../web-search/provider';
import { isSearchEngineUrl } from '../web-search/quality';
import { sanitizeVisualizationHtml } from '../assistant/rich-format';

const PULSE_MODEL = MODELS[0].openrouter_id; // cheap/fast tier for map-reduce summarization

/** Cheap-tier section summarizer for long-document map-reduce. Costs are reported
 *  through ctx.addCost so the agent loop batches them; deduction is deferred. */
function makeSectionSummarizer(ctx: ToolContext): SectionSummarizer | undefined {
  if (!ctx.userId) return undefined;
  return async ({ text, hint }) => {
    const { content, usage } = await callOpenRouterJson(
      [
        { role: 'system', content: 'You condense one section of a long document. Reply with only the summary — no preamble. Keep concrete numbers, names, dates.' },
        { role: 'user', content: `${hint}\n\n---\n${text}` },
      ],
      PULSE_MODEL,
      ctx.userId,
      false,
    );
    ctx.addCost?.(usage.costUsd);
    return content;
  };
}

/** Resolve a browser-profile id to the launch config the Rust layer expects. The
 *  managed default needs no config (Rust defaults to Agent Chrome). */
function browserProfileArg(id?: string | null): Record<string, unknown> | null {
  const p = id ? getBrowserProfile(id) : undefined;
  if (!p || p.id === DEFAULT_BROWSER_PROFILE.id) return null;
  return { kind: p.kind, executablePath: p.executablePath, profileDir: p.profileDir, remoteDebuggingPort: p.remoteDebuggingPort, cdpEndpoint: p.cdpEndpoint };
}

const ERR = (error: string): ControlToolResult => ({ success: false, output: '', error });

function columnToLetters(column: string | number): string {
  if (typeof column === 'string') {
    const trimmed = column.trim();
    if (/^[A-Za-z]+$/.test(trimmed)) return trimmed.toUpperCase();
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return columnToLetters(n);
    return trimmed.toUpperCase();
  }
  let n = Math.floor(column);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || 'A';
}

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
    // ── email composer ─────────────────────────────────────────────────────
    case 'email.compose': {
      const to = String(action.to ?? '').trim();
      const sources = action.sources?.length ? toSourceChips(action.sources) : (ctx.references ?? []).map((r) => ({ label: r.label, kind: r.kind, fileId: r.driveFileId, url: r.webViewLink ?? r.url }));
      const base: EmailDraft = {
        id: newEmailDraftId(),
        to,
        cc: action.cc ? String(action.cc) : undefined,
        bcc: action.bcc ? String(action.bcc) : undefined,
        subject: String(action.subject ?? ''),
        body: String(action.body ?? ''),
        status: 'local_draft',
        gmailConnected: false,
        sources,
        updatedAt: new Date().toISOString(),
      };
      if (!to) {
        return { success: false, output: '', error: 'missing_recipient', details: { emailDraft: { ...base, status: 'failed', error: 'missing_recipient' } } };
      }
      // Decide connected/not by the ACTUAL Gmail call, not a synchronous state
      // probe: the connection resolves credentials async (OAuth refresh, dev
      // shortcut, MCP), so a sync probe can wrongly say "not connected" while a
      // real call would succeed.
      const localDraft = (): ControlToolResult => {
        const draft: EmailDraft = { ...base, status: 'local_draft', gmailConnected: false };
        return {
          success: true,
          output: `Email vázlat elkészült a chat composerben (címzett: ${to} – "${draft.subject}"). A Gmail jelenleg NINCS csatlakoztatva, ezért Gmail piszkozat nem jött létre — csatlakoztasd a Gmailt a Connections oldalon a mentéshez/küldéshez. [local_draft]`,
          details: { emailDraft: draft },
        };
      };
      if (!ctx.connections) return localDraft();
      const res = await ctx.connections.call('google-workspace', 'google.gmail.create_draft', {
        to: base.to, cc: base.cc, bcc: base.bcc, subject: base.subject, body: base.body,
      });
      if (res.success) {
        const draftId = String((res.details as Record<string, unknown> | undefined)?.draftId ?? '');
        const verified = Boolean((res.details as Record<string, unknown> | undefined)?.verified);
        const draft: EmailDraft = { ...base, gmailConnected: true, status: 'gmail_draft_created', gmailDraftId: draftId, webUrl: gmailDraftUrl(draftId) };
        return {
          success: true,
          output: `Gmail piszkozat létrehozva (${to} – "${base.subject}"). Read-back: ${verified ? 'megerősítve' : 'nem megerősíthető'}. [gmail_draft_created]`,
          details: { emailDraft: draft },
        };
      }
      // A missing/blocked connection → keep an editable local draft + Connect CTA.
      const blocker = (res.details as Record<string, unknown> | undefined)?.blocker;
      const errText = `${res.error ?? ''} ${res.output ?? ''}`.toLowerCase();
      const missingConnection = Boolean(blocker) || /missing_auth|not connected|connect|scaffold|unknown_connection|no[_ ]?credential|reconnect|expired/.test(errText);
      if (missingConnection) return localDraft();
      const failedDraft: EmailDraft = { ...base, gmailConnected: true, status: 'failed', error: res.error ?? res.output };
      return { success: false, output: res.output ?? '', error: res.error ?? 'gmail_draft_failed', details: { emailDraft: failedDraft } };
    }

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

    // ── isolated Python code execution ─────────────────────────────────────
    case 'code.execute':
      return executeCode(action, ctx);
    case 'code.install_package':
      return installPackageAction(action);
    case 'visualization.render': {
      const html = typeof action.html === 'string' ? action.html.trim() : '';
      if (!html) return ERR('visualization.render requires html');
      const safeHtml = sanitizeVisualizationHtml(html);
      const height = Number.isFinite(action.height) ? Math.max(220, Math.min(820, Math.round(action.height ?? 420))) : undefined;
      const title = String(action.title ?? 'Visualization').trim() || 'Visualization';
      return {
        success: true,
        output: `Visualization rendered: ${title}`,
        details: { visualization: { title, html: safeHtml, height } },
      };
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
      const result = await readDocument(ref, { summarizer: makeSectionSummarizer(ctx) });
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        error: result.ok ? undefined : result.error,
        details: { documentRead: result },
      };
    }
    case 'document.read_many': {
      const refs = (action.refs ?? []).map((ref) => refFromAction(ctx, ref));
      const results = await readManyDocuments(
        refs.length ? refs : (ctx.references ?? []).filter((ref) => ref.kind !== 'folder'),
        { summarizer: makeSectionSummarizer(ctx) },
      );
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
        summarizer: makeSectionSummarizer(ctx),
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
      const result = await readDocument(ref, { summarizer: makeSectionSummarizer(ctx) });
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
    case 'sheet.update_cells': {
      if (!action.cells.length) return ERR('sheet.update_cells requires at least one cell');
      const cells = action.cells.map((cell) => ({
        ref: `${columnToLetters(cell.column)}${cell.row}`,
        value: cell.value === null ? '' : String(cell.value),
      }));
      const r = await tryInvoke<string>('sheet_write', {
        path: action.path, sheet: action.sheet ?? null, rows: null,
        cells, startCell: null, mode: 'edit',
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
    case 'sheet.profile': {
      const r = await tryInvoke<string>('sheet_profile', {
        path: action.path, sheet: action.sheet ?? null, sampleSize: action.sample_size ?? null,
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.query': {
      const r = await tryInvoke<string>('sheet_query', {
        path: action.path,
        sheet: action.sheet ?? null,
        query: {
          filter: action.filter ?? null,
          columns: action.columns ?? null,
          aggregate: action.aggregate ?? null,
          group_by: action.group_by ?? null,
          limit: action.limit ?? null,
        },
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.format_range': {
      const r = await tryInvoke<string>('sheet_format_range', {
        path: action.path,
        sheet: action.sheet ?? null,
        format: {
          range: action.range,
          background: action.background ?? null,
          font_color: action.font_color ?? null,
          bold: action.bold ?? null,
          italic: action.italic ?? null,
          font_size: action.font_size ?? null,
          border: action.border ?? null,
          number_format: action.number_format ?? null,
          column_width: action.column_width ?? null,
          freeze_rows: action.freeze_rows ?? null,
          freeze_cols: action.freeze_cols ?? null,
          conditional: action.conditional ?? null,
        },
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.add_chart': {
      const r = await tryInvoke<string>('sheet_add_chart', {
        path: action.path,
        sheet: action.sheet ?? null,
        chart: {
          chart_type: action.chart_type,
          series: action.series,
          series_titles: action.series_titles ?? null,
          categories: action.categories ?? null,
          title: action.title ?? null,
          from_cell: action.from_cell ?? null,
          to_cell: action.to_cell ?? null,
        },
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'sheet.add_table': {
      const r = await tryInvoke<string>('sheet_add_table', {
        path: action.path,
        sheet: action.sheet ?? null,
        table: { range: action.range, name: action.name ?? null, style: action.style ?? null },
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    case 'doc.read': {
      const ref = refFromAction(ctx, { path: action.path, label: action.path }, 'file');
      const result = await readDocument(ref, { summarizer: makeSectionSummarizer(ctx) });
      return { success: result.ok, output: JSON.stringify(result, null, 2), error: result.ok ? undefined : result.error, details: { documentRead: result } };
    }
    case 'doc.write_txt': {
      const r = await tryInvoke<void>('file_write', { path: action.path, content: action.content });
      return r.ok ? { success: true, output: `Wrote text document ${action.path}` } : ERR(r.error);
    }
    case 'doc.write_docx': {
      const r = await tryInvoke<string>('docx_write', {
        path: action.path,
        content: action.content,
        title: action.title ?? null,
        tables: action.tables ?? null,
      });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }

    case 'artifact.plan': {
      return { success: true, output: JSON.stringify(planArtifact(action.request, action.references ?? []), null, 2) };
    }
    case 'artifact.render_pdf': {
      const r = await tryInvoke<string>('artifact_render_pdf', {
        title: action.title ?? action.model.title,
        model: action.model,
        templateId: action.template_id ?? null,
        outputName: action.output_name ?? null,
        options: null,
      });
      return r.ok ? { success: true, output: r.value, details: { artifact: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'artifact.render_docx': {
      const r = await tryInvoke<string>('artifact_render_docx', {
        title: action.title ?? action.model.title,
        model: action.model,
        templateId: action.template_id ?? null,
        outputName: action.output_name ?? null,
      });
      return r.ok ? { success: true, output: r.value, details: { artifact: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'artifact.render_pptx': {
      const r = await tryInvoke<string>('artifact_render_pptx', {
        title: action.title ?? action.model.title,
        model: action.model,
        templateId: action.template_id ?? null,
        outputName: action.output_name ?? null,
      });
      return r.ok ? { success: true, output: r.value, details: { artifact: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'artifact.convert': {
      const r = await tryInvoke<string>('artifact_convert', { fromPath: action.from_path, to: action.to, outputName: action.output_name ?? null });
      return r.ok ? { success: true, output: r.value, details: { artifact: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'artifact.preview': {
      const r = await tryInvoke<string>('artifact_preview', { path: action.path, pages: action.pages ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.verify': {
      const r = await tryInvoke<string>('artifact_verify', { path: action.path, expectedText: action.expected_text ?? [], expectedKind: action.expected_kind ?? null });
      return r.ok ? { success: true, output: r.value, details: { artifactVerification: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'artifact.design_lint': {
      const r = await tryInvoke<string>('artifact_design_lint', { path: action.path, kind: action.kind ?? null, model: action.model ?? null });
      return r.ok ? { success: true, output: r.value, details: { artifactDesignLint: JSON.parse(r.value) } } : ERR(r.error);
    }
    case 'presentation.quality_lint': {
      const result = lintPresentation(action.model, action.expected_slide_count);
      return { success: true, output: JSON.stringify(result, null, 2), details: { presentationLint: result } };
    }
    case 'artifact.list': {
      const r = await tryInvoke<string>('artifact_list', { workspaceId: action.workspace_id ?? null, taskId: action.task_id ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.open': {
      const r = await tryInvoke<string>('artifact_open', { path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.copy_to': {
      const r = await tryInvoke<string>('artifact_copy_to', { artifactId: action.artifact_id ?? null, fromPath: action.from_path ?? null, targetDir: action.target_dir });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.pdf_extract_text': {
      const r = await tryInvoke<string>('artifact_pdf_extract_text', { path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.pdf_metadata': {
      const r = await tryInvoke<string>('artifact_pdf_metadata', { path: action.path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.pdf_page_count': {
      const r = await tryInvoke<number>('artifact_pdf_page_count', { path: action.path });
      return r.ok ? { success: true, output: String(r.value) } : ERR(r.error);
    }
    case 'artifact.pdf_merge': {
      const r = await tryInvoke<string>('artifact_pdf_merge', { paths: action.paths, outputPath: action.output_path });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.pdf_split': {
      const r = await tryInvoke<string>('artifact_pdf_split', { path: action.path, outputDir: action.output_dir, pages: action.pages ?? null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'artifact.pdf_watermark': {
      const r = await tryInvoke<string>('artifact_pdf_watermark', { path: action.path, outputPath: action.output_path, text: action.text });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
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
      if (isSearchEngineUrl(action.url)) {
        return ERR('blocked_search_engine_browser_fallback: normal internet search must use web.search/web.batch_search, not browser.open on search result pages.');
      }
      const r = await tryInvoke<string>('browser_open', { url: action.url, browserProfile: browserProfileArg(action.browser_profile_id) });
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
    case 'browser.login': {
      // Resolve which app/credential/browser to use, then sign in. The password is
      // read from the vault HERE and typed straight into the page — it is never part
      // of the action, the returned output, the audit, or the model context.
      const app = action.app_id ? getApp(action.app_id) : undefined;
      let domain = normalizeDomain(action.domain ?? action.url ?? app?.domain ?? app?.loginUrl ?? app?.homeUrl ?? '');
      if (!domain) {
        const read = await tryInvoke<string>('browser_read', { selector: null });
        if (read.ok) domain = normalizeDomain(read.value.match(/^URL:\s*(.+)$/im)?.[1] ?? '');
      }
      // Credential resolution: explicit id → app's linked credential → domain match.
      const cred = action.credential_id ? getCredential(action.credential_id)
        : app?.credentialId ? getCredential(app.credentialId)
        : domain ? getCredentialForDomain(domain) : undefined;
      if (!cred) return ERR(`no_saved_login_for:${domain || action.app_id || 'unknown'}`);
      const password = await resolveCredentialPassword(cred.id);
      if (!password) return ERR('login_password_unavailable');
      const loginUrl = action.url ?? app?.loginUrl ?? cred.loginUrl ?? undefined;
      const browserProfileId = action.browser_profile_id ?? app?.preferredBrowserId ?? null;

      const typeFirst = async (targets: string[], text: string): Promise<boolean> => {
        for (const target of targets) {
          const r = await tryInvoke<string>('browser_type', { target, text });
          if (r.ok) return true;
        }
        return false;
      };
      const clickFirst = async (targets: string[]): Promise<boolean> => {
        for (const target of targets) {
          const r = await tryInvoke<string>('browser_click', { target });
          if (r.ok) return true;
        }
        return false;
      };

      const userTargets = [action.username_field, 'input[type=email]', 'input[name=email]', 'input[name=username]', 'input[id=identifierId]', 'Email or phone', 'Email', 'Username', 'Phone'].filter(Boolean) as string[];
      const passTargets = [action.password_field, 'input[type=password]', 'input[name=password]', 'Password'].filter(Boolean) as string[];
      const submitTargets = [action.submit_text, 'Sign in', 'Log in', 'Login', 'Continue', 'Next', 'Submit'].filter(Boolean) as string[];

      if (loginUrl) {
        const open = await tryInvoke<string>('browser_open', { url: loginUrl, browserProfile: browserProfileArg(browserProfileId) });
        if (!open.ok) return ERR(open.error);
        await tryInvoke<string>('browser_wait', { text: null, selector: null, seconds: 2 });
      }

      const typedUser = await typeFirst(userTargets, cred.username);
      if (!typedUser) return ERR('login_username_field_not_found');

      // Try the password directly; if it isn't on the page yet (two-step logins),
      // advance with Next/Continue and retry once.
      let typedPass = await typeFirst(passTargets, password);
      if (!typedPass) {
        await clickFirst(submitTargets);
        await tryInvoke<string>('browser_wait', { text: null, selector: null, seconds: 2 });
        typedPass = await typeFirst(passTargets, password);
      }
      if (!typedPass) return ERR('login_password_field_not_found');

      if (!(await clickFirst(submitTargets))) {
        await tryInvoke<string>('browser_key', { key: 'Enter' });
      }
      await tryInvoke<string>('browser_wait', { text: null, selector: null, seconds: 3 });
      markCredentialUsed(cred.id);
      if (app) markAppUsed(app.id);
      const verify = await tryInvoke<string>('browser_read', { selector: null });
      const onLoginPage = verify.ok && /password|sign in|log in/i.test(verify.value) && /input/i.test(verify.value);
      return {
        success: true,
        output: `Signed in to ${cred.domain} as ${cred.username}${onLoginPage ? ' (verify: page may still show a login form — check for 2FA).' : '.'}`,
      };
    }

    // ── connections / skills / workflows ───────────────────────────────────
    case 'web.search': {
      try {
        const result = await webSearch(action);
        return { success: true, output: JSON.stringify(result, null, 2), details: { webSearch: result } };
      } catch (error) {
        return ERR(error instanceof Error ? error.message : String(error));
      }
    }
    case 'web.batch_search': {
      try {
        const results = await webBatchSearch(action);
        return { success: true, output: JSON.stringify({ queries: action.queries.length, results }, null, 2), details: { webBatchSearch: results } };
      } catch (error) {
        return ERR(error instanceof Error ? error.message : String(error));
      }
    }
    case 'web.open_result': {
      const r = await tryInvoke<string>('browser_open', { url: action.url, browserProfile: null });
      return r.ok ? { success: true, output: r.value } : ERR(r.error);
    }
    case 'web.extract_page': {
      try {
        const page = await extractPage(action.url, action.maxChars);
        return { success: true, output: JSON.stringify(page, null, 2), details: { extractedPage: page } };
      } catch (error) {
        return ERR(error instanceof Error ? error.message : String(error));
      }
    }
    case 'web.extract_contact_info': {
      try {
        const text = action.text ?? action.html ?? (await extractPage(action.url)).text;
        const contactInfo = extractContactInfo(action.url, text);
        return { success: true, output: JSON.stringify(contactInfo, null, 2), details: { contactInfo } };
      } catch (error) {
        return ERR(error instanceof Error ? error.message : String(error));
      }
    }
    case 'web.verify_source': {
      try {
        const page = await extractPage(action.url, 8000);
        const host = new URL(action.url).hostname.replace(/^www\./, '').toLowerCase();
        const expected = action.expectedDomain?.replace(/^www\./, '').toLowerCase();
        const domainOk = expected ? host === expected || host.endsWith(`.${expected}`) : true;
        const claimOk = action.claim ? page.text.toLowerCase().includes(action.claim.toLowerCase()) : true;
        const verified = domainOk && claimOk;
        return {
          success: true,
          output: JSON.stringify({ url: action.url, verified, domainOk, claimOk, title: page.title }, null, 2),
          details: { sourceVerification: { verified, domainOk, claimOk } },
        };
      } catch (error) {
        return ERR(error instanceof Error ? error.message : String(error));
      }
    }

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
