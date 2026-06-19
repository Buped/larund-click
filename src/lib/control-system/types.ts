// Larund Click — No-Mouse AI Operator control surface.
//
// This file defines the ONLY actions the agent core may emit. There is no mouse,
// cursor, screenshot-click, OCR-click, bbox, coordinate, grid or visual target
// action anywhere in this union — by design. See docs/NO_MOUSE_CORE.md.

export type ToolRisk =
  | 'read_only'
  | 'local_write'
  | 'external_read'
  | 'external_write'
  | 'external_send'
  | 'destructive'
  | 'credential_access'
  | 'process_exec';

export type ControlAction =
  // ── Runtime: CLI / process ────────────────────────────────────────────
  | { action: 'cli.run'; cmd: string; working_dir?: string; risk?: ToolRisk }
  | { action: 'process.start'; cmd: string; working_dir?: string; background?: boolean }
  | { action: 'process.status'; process_id: string }
  | { action: 'process.kill'; process_id: string }

  // ── Files / folders ───────────────────────────────────────────────────
  | { action: 'file.read'; path: string }
  | { action: 'file.write'; path: string; content: string }
  | { action: 'file.edit'; path: string; find?: string; replace?: string; patch?: string }
  | { action: 'file.list'; path: string }
  | { action: 'file.mkdir'; path: string; recursive?: boolean }
  | { action: 'file.copy'; from: string; to: string }
  | { action: 'file.move'; from: string; to: string }
  | { action: 'file.delete'; path: string; recursive?: boolean }
  | { action: 'file.search'; path: string; query: string; glob?: string }
  | { action: 'file.tree'; path: string; depth?: number }
  | { action: 'file.exists'; path: string }
  | { action: 'file.metadata'; path: string }

  // Structured document ingestion. These tools read referenced files/folders
  // as first-class inputs instead of forcing the model to infer contents.
  | { action: 'document.read'; ref_id?: string; path?: string; url?: string; label?: string; kind?: 'file' | 'url' | 'google_doc' | 'google_sheet' | 'google_drive_file' }
  | { action: 'document.read_many'; refs?: Array<{ id?: string; path?: string; url?: string; label?: string; kind?: 'file' | 'url' | 'google_doc' | 'google_sheet' | 'google_drive_file' }> }
  | { action: 'folder.scan'; ref_id?: string; path?: string; label?: string; max_entries?: number; max_depth?: number }
  | { action: 'folder.read_relevant'; ref_id?: string; path?: string; label?: string; query?: string; max_entries?: number; max_depth?: number }
  | { action: 'document.summarize'; ref_id?: string; path?: string; url?: string; label?: string }

  // ── Data: spreadsheets ────────────────────────────────────────────────
  | { action: 'sheet.read'; path: string; sheet?: string; max_rows?: number }
  | { action: 'sheet.write'; path: string; sheet?: string; rows?: string[][]; start_cell?: string; mode?: 'overwrite' | 'append' }
  | { action: 'sheet.append'; path: string; sheet?: string; rows: string[][] }
  | { action: 'sheet.export_csv'; path: string; target_path: string; sheet?: string }
  | { action: 'sheet.to_json'; path: string; sheet?: string; max_rows?: number }

  // Local documents. GUI Office automation is optional; file output is primary.
  | { action: 'doc.read'; path: string }
  | { action: 'doc.write_txt'; path: string; content: string }
  | { action: 'doc.write_docx'; path: string; content: string; title?: string; tables?: string[][][] }

  // ── Clipboard ─────────────────────────────────────────────────────────
  | { action: 'clipboard.get' }
  | { action: 'clipboard.set'; text: string }

  // ── Apps / windows / deterministic keyboard ───────────────────────────
  | { action: 'app.open'; name?: string; app_id?: string; path?: string; uri?: string }
  | { action: 'window.list' }
  | { action: 'window.focus'; title: string }
  | { action: 'keyboard.press'; key: string }
  | { action: 'keyboard.combo'; keys: string[] }

  // ── Browser (CDP / DOM — element-based, never pixels) ──────────────────
  | { action: 'browser.open'; url: string; profile?: string; browser_profile_id?: string }
  | { action: 'browser.read'; selector?: string }
  | { action: 'browser.get_state' }
  | { action: 'browser.click'; target: string }
  | { action: 'browser.type'; target: string; text: string }
  | { action: 'browser.key'; key: string }
  | { action: 'browser.shortcut'; keys: string[] }
  | { action: 'browser.paste'; text?: string }
  | { action: 'browser.assert_text'; text: string }
  | { action: 'browser.assert_url'; url: string }
  | { action: 'browser.wait'; text?: string; selector?: string; seconds?: number }
  | { action: 'browser.extract_table'; selector?: string }
  | { action: 'browser.download'; url?: string; target?: string; save_as?: string }
  | { action: 'browser.upload'; target: string; path: string }
  // Sign in to a site using a SAVED credential. The password is read from the
  // vault inside the executor and typed directly into the page — it never appears
  // in this action, the model context, or logs. Identify the login by app_id (a
  // saved App), credential_id, domain, or url; optionally pick a browser profile.
  | { action: 'browser.login'; url?: string; domain?: string; app_id?: string; credential_id?: string; browser_profile_id?: string; username_field?: string; password_field?: string; submit_text?: string }

  // ── Connections / skills / workflows ──────────────────────────────────
  | { action: 'connection.call'; connection: string; tool: string; args: Record<string, unknown> }
  | { action: 'skill.run'; skill: string; input: Record<string, unknown> | string }
  | { action: 'workflow.start'; workflow: string; input: Record<string, unknown> | string }
  | { action: 'workflow.status'; workflow_id: string }
  | { action: 'workflow.cancel'; workflow_id: string }

  // ── Control flow / human-in-the-loop ──────────────────────────────────
  | { action: 'approval.request'; reason: string; proposed_action: ControlAction }
  | { action: 'task.complete'; summary: string }
  | { action: 'ask_user'; question: string };

export type ControlActionName = ControlAction['action'];

export interface ControlToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** Set when an action requires human approval before it can run. */
  approvalRequired?: boolean;
  details?: Record<string, unknown>;
}
