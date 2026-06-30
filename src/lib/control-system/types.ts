// Larund Click — No-Mouse AI Operator control surface.
//
// This file defines the ONLY actions the agent core may emit. There is no mouse,
// cursor, screenshot-click, OCR-click, bbox, coordinate, grid or visual target
// action anywhere in this union — by design. See docs/NO_MOUSE_CORE.md.
//
// The single exception is `screen.verify`: a READ-ONLY visual self-check that
// captures a screenshot and asks a vision model whether the task succeeded. It is
// perception, not control — it never returns coordinates or clicks — so the
// no-mouse contract (which forbids visual *control*) is preserved.

export type ToolRisk =
  | 'read_only'
  | 'local_write'
  | 'external_read'
  | 'external_write'
  | 'external_send'
  | 'destructive'
  | 'credential_access'
  | 'process_exec';

export type FileMutationTargetPolicy =
  | 'preserve_original_format'
  | 'roundtrip_with_backup'
  | 'ask_before_format_change'
  | 'create_new_only_if_user_requested';

export interface WebSearchInput {
  query: string;
  locale?: string;
  country?: string;
  maxResults?: number;
  depth?: 'quick' | 'standard';
  bannedDomains?: string[];
  preferredDomains?: string[];
}

export interface WebBatchSearchInput {
  queries: string[];
  concurrency?: number;
  maxResultsPerQuery?: number;
  locale?: string;
  country?: string;
}

export interface SheetUpdateCell {
  row: number;
  column: string | number;
  value: string | number | boolean | null;
}

type ControlActionVariant =
  // ── Runtime: CLI / process ────────────────────────────────────────────
  | { action: 'cli.run'; cmd: string; working_dir?: string; risk?: ToolRisk }
  | { action: 'process.start'; cmd: string; working_dir?: string; background?: boolean }
  | { action: 'process.status'; process_id: string }
  | { action: 'process.kill'; process_id: string }

  // ── Isolated Python code execution ────────────────────────────────────
  // Runs agent-authored Python in a Larund-owned venv inside a throwaway run
  // directory (input files copied in, new output files harvested out). Static
  // isolation gate blocks out-of-sandbox FS access, network (unless allowed) and
  // sandbox-escape calls. Risk is process_exec; network always needs approval.
  | { action: 'code.execute'; code: string; input_refs?: string[]; timeout_secs?: number; allow_network?: boolean; label?: string }
  // Approval-gated install of ONE package outside the base allowlist.
  | { action: 'code.install_package'; package: string; reason?: string }
  | { action: 'visualization.render'; title?: string; html: string; height?: number }

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
  | { action: 'sheet.update_cells'; path: string; sheet?: string; cells: SheetUpdateCell[]; preserveExisting?: true; backup?: true; policy?: FileMutationTargetPolicy }
  | { action: 'sheet.append'; path: string; sheet?: string; rows: string[][] }
  | { action: 'sheet.export_csv'; path: string; target_path: string; sheet?: string }
  | { action: 'sheet.to_json'; path: string; sheet?: string; max_rows?: number }
  | { action: 'sheet.profile'; path: string; sheet?: string; sample_size?: number }
  | {
      action: 'sheet.query';
      path: string;
      sheet?: string;
      filter?: { match?: 'all' | 'any'; conditions: Array<{ column: string; op: string; value?: unknown }> };
      columns?: string[];
      aggregate?: Array<{ op: string; column?: string; as?: string }>;
      group_by?: string[];
      limit?: number;
    }
  | {
      action: 'sheet.format_range';
      path: string;
      sheet?: string;
      range: string;
      background?: string;
      font_color?: string;
      bold?: boolean;
      italic?: boolean;
      font_size?: number;
      border?: boolean;
      number_format?: string;
      column_width?: number;
      freeze_rows?: number;
      freeze_cols?: number;
      conditional?: { op: string; value: number; background: string; font_color?: string };
    }
  | {
      action: 'sheet.add_chart';
      path: string;
      sheet?: string;
      chart_type: 'bar' | 'line' | 'pie' | 'area' | 'doughnut' | 'scatter' | 'radar';
      series: string[];
      series_titles?: string[];
      categories?: string[];
      title?: string;
      from_cell?: string;
      to_cell?: string;
    }
  | { action: 'sheet.add_table'; path: string; sheet?: string; range: string; name?: string; style?: string }

  // Local documents. GUI Office automation is optional; file output is primary.
  | { action: 'doc.read'; path: string }
  | { action: 'doc.write_txt'; path: string; content: string }
  | { action: 'doc.write_docx'; path: string; content: string; title?: string; tables?: string[][][] }

  // Local artifact generation. These actions create first-class, verified files
  // under Larund's local artifact storage instead of plain placeholder text.
  | { action: 'artifact.plan'; request: string; references?: string[] }
  | { action: 'artifact.render_pdf'; model: import('../artifacts').DocumentArtifactModel | import('../artifacts').InvoiceArtifactModel; template_id?: string; output_name?: string; title?: string }
  | { action: 'artifact.design_lint'; path: string; kind?: string; model?: unknown }
  | { action: 'artifact.render_docx'; model: import('../artifacts').DocumentArtifactModel; template_id?: string; output_name?: string; title?: string }
  | { action: 'artifact.render_pptx'; model: import('../artifacts').PresentationArtifactModel | import('../artifacts/presentation').PresentationDeckModel; template_id?: string; output_name?: string; title?: string }
  | { action: 'presentation.quality_lint'; model: import('../artifacts/presentation').PresentationDeckModel; expected_slide_count?: number }
  | { action: 'artifact.convert'; from_path: string; to: 'pdf' | 'docx' | 'pptx' | 'html'; output_name?: string }
  | { action: 'artifact.preview'; path: string; pages?: number[] }
  | { action: 'artifact.verify'; path: string; expected_text?: string[]; expected_kind?: import('../artifacts').ArtifactKind }
  | { action: 'artifact.list'; workspace_id?: string; task_id?: string }
  | { action: 'artifact.open'; path: string }
  | { action: 'artifact.copy_to'; artifact_id?: string; from_path?: string; target_dir: string }
  | { action: 'artifact.pdf_merge'; paths: string[]; output_path: string }
  | { action: 'artifact.pdf_split'; path: string; output_dir: string; pages?: number[] }
  | { action: 'artifact.pdf_watermark'; path: string; output_path: string; text: string }
  | { action: 'artifact.pdf_extract_text'; path: string }
  | { action: 'artifact.pdf_metadata'; path: string }
  | { action: 'artifact.pdf_page_count'; path: string }

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
  | { action: 'browser.list_tabs' }
  | { action: 'browser.switch_tab'; target_id: string }
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

  // First-class web search. General lookup uses this before browser automation;
  // browser.open is reserved for selected result pages or interactive sites.
  | ({ action: 'web.search' } & WebSearchInput)
  | ({ action: 'web.batch_search' } & WebBatchSearchInput)
  | { action: 'web.open_result'; url: string }
  | { action: 'web.extract_page'; url: string; maxChars?: number }
  | { action: 'web.extract_contact_info'; url: string; html?: string; text?: string }
  | { action: 'web.verify_source'; url: string; claim?: string; expectedDomain?: string }

  // ── Email composer ────────────────────────────────────────────────────
  // Surface an editable email draft as a chat card. When Gmail is connected this
  // also creates a real Gmail draft (provider evidence); otherwise it stays a
  // local draft and the card shows a Connect-Gmail CTA. Sending is a separate,
  // approval-gated step (the card's Send button → google.gmail.send).
  | { action: 'email.compose'; to?: string; cc?: string; bcc?: string; subject?: string; body?: string; sources?: Array<{ label: string; kind?: string; fileId?: string; url?: string }>; send?: boolean }

  // ── Connections / skills / workflows ──────────────────────────────────
  | { action: 'connection.call'; connection: string; tool: string; args: Record<string, unknown> }
  | { action: 'skill.run'; skill: string; input: Record<string, unknown> | string }
  | { action: 'workflow.start'; workflow: string; input: Record<string, unknown> | string }
  | { action: 'workflow.status'; workflow_id: string }
  | { action: 'workflow.cancel'; workflow_id: string }

  // ── Visual self-check (read-only perception, NEVER control) ───────────
  // Capture the current surface and visually verify it against the task's
  // success criteria. Returns a structured verdict; emits no coordinates/clicks.
  | { action: 'screen.verify'; surface?: 'browser' | 'desktop' | 'artifact'; criteria?: string[]; question?: string; path?: string; pages?: number[] }

  // ── Control flow / human-in-the-loop ──────────────────────────────────
  | { action: 'approval.request'; reason: string; proposed_action: ControlAction }
  | { action: 'task.complete'; summary: string }
  | { action: 'ask_user'; question: string };

/**
 * Optional model-emitted self-assessment fields, valid on ANY action.
 *
 * In semi-autonomous mode the model marks high-consequence / irreversible
 * actions (sending email/messages, deleting, paying, external publishing,
 * permission changes) with `critical: true` and a short `confirm_reason`, so the
 * policy gate asks the user for approval. Trivial reversible steps (rename/move a
 * file, drag a card, read) are left unmarked and run automatically. See the
 * `decide()` hybrid logic in src/lib/tools/policy.ts.
 */
export type ControlAction = ControlActionVariant & {
  critical?: boolean;
  confirm_reason?: string;
};

export type ControlActionName = ControlActionVariant['action'];

export interface ControlToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** Set when an action requires human approval before it can run. */
  approvalRequired?: boolean;
  /**
   * Free-text the user typed via the approval card's "Other" option. When
   * present the loop treats it as a steering correction and re-plans the next
   * actions instead of executing the proposed one.
   */
  approvalFeedback?: string;
  details?: Record<string, unknown>;
}
