// Capability matrix — the single source of truth for which operator capabilities
// the Larund Operator Benchmarks depend on, and whether they are actually backed by
// implemented code. The benchmark runner scores readiness against this map, and the
// audit report (docs/BENCHMARK_AUDIT_REPORT.md) is generated from the same data, so
// the two never drift. Each entry names the control actions / Rust commands that back
// it and an honest status.

import type { ControlActionName } from '../control-system/types';

export type CapabilityStatus = 'available' | 'partial' | 'missing';

export interface CapabilityInfo {
  id: string;
  label: string;
  status: CapabilityStatus;
  /** Control actions (or runtime features) that implement this capability. */
  backedBy: Array<ControlActionName | string>;
  /** Where the capability is implemented — used as audit evidence. */
  evidence: string;
  /** What is still missing or limited (empty when fully available). */
  missingWork?: string;
}

export const CAPABILITY_MATRIX = {
  // ── Browser ──────────────────────────────────────────────────────────────
  'browser.open': {
    id: 'browser.open', label: 'Browser open + state', status: 'available',
    backedBy: ['browser.open', 'browser.read', 'browser.get_state', 'browser.wait'],
    evidence: 'executor.ts browser.open→browser_open (CDP Page.navigate); browser.read/get_state→browser_read.',
  },
  'browser.read': {
    id: 'browser.read', label: 'Browser DOM read', status: 'available',
    backedBy: ['browser.read', 'browser.get_state', 'browser.assert_text', 'browser.assert_url'],
    evidence: 'browser.rs READ_JS returns URL/title/inputs/buttons + login/captcha STATE_HINTS; selector read supported.',
  },
  'browser.click': {
    id: 'browser.click', label: 'Browser click by text/selector', status: 'available',
    backedBy: ['browser.click'],
    evidence: 'browser.rs CLICK_JS matches by visible text/aria/selector, dispatches a real element-center click (no pixels).',
  },
  'browser.type': {
    id: 'browser.type', label: 'Browser type into field', status: 'available',
    backedBy: ['browser.type', 'browser.key', 'browser.shortcut', 'browser.paste'],
    evidence: 'browser.rs TYPE_JS targets one field and returns AMBIGUOUS rather than guessing; paste via CDP Ctrl+V.',
  },
  'browser.wait': {
    id: 'browser.wait', label: 'Browser wait for state', status: 'available',
    backedBy: ['browser.wait'],
    evidence: 'browser.rs browser_wait polls for text or sleeps up to 120s.',
  },
  'browser.download': {
    id: 'browser.download', label: 'Browser file download', status: 'available',
    backedBy: ['browser.download'],
    evidence: 'browser.rs browser_download sets CDP download behaviour, triggers, waits for completion, moves/renames to the target and returns the final path.',
  },
  'browser.upload': {
    id: 'browser.upload', label: 'Browser file upload', status: 'available',
    backedBy: ['browser.upload'],
    evidence: 'browser.rs browser_upload uses CDP DOM.setFileInputFiles (no mouse).',
  },
  'browser.extract_table': {
    id: 'browser.extract_table', label: 'Browser table extraction', status: 'available',
    backedBy: ['browser.extract_table'],
    evidence: 'browser.rs browser_extract_table returns the largest table as TSV; executor falls back to browser_read.',
  },
  'browser.login': {
    id: 'browser.login', label: 'Saved-credential login', status: 'available',
    backedBy: ['browser.login'],
    evidence: 'executor.ts browser.login resolves a vault credential by app_id/credential_id/domain and types the password directly into the page; the password never enters the action, model context, audit or UI.',
  },

  // ── Apps / logins / mentions ─────────────────────────────────────────────
  'app_profiles': {
    id: 'app_profiles', label: 'App profiles + saved logins', status: 'available',
    backedBy: ['app.open', 'browser.login'],
    evidence: 'apps/store.ts AppProfile (url/loginUrl/username/preferredBrowser/usageHints + credentialId pointer); password lives only in credentials vault.',
  },
  'app_mention': {
    id: 'app_mention', label: '@App mention context', status: 'available',
    backedBy: ['app.open', 'browser.open', 'browser.login'],
    evidence: 'mentions/resolve.ts renders a safe "## App:" block (domain/urls/preferredBrowser/usage) — never the password — and points the model at browser.login with app_id.',
  },

  // ── Files / folders / documents ──────────────────────────────────────────
  'file_ops': {
    id: 'file_ops', label: 'File + folder operations', status: 'available',
    backedBy: ['file.list', 'file.read', 'file.write', 'file.move', 'file.copy', 'file.delete', 'file.search', 'file.tree', 'file.exists', 'file.metadata', 'file.mkdir'],
    evidence: 'executor.ts maps each to Rust fs_ops commands; delete is risk=destructive (approval-gated).',
  },
  'folder_scan': {
    id: 'folder_scan', label: 'Folder scan / relevant read', status: 'available',
    backedBy: ['folder.scan', 'folder.read_relevant'],
    evidence: 'document-reader/folder-ingest.ts; executor folder.scan/folder.read_relevant.',
  },
  'document_read': {
    id: 'document_read', label: 'Document read (txt/md/docx/csv/xlsx/images)', status: 'available',
    backedBy: ['document.read', 'document.read_many', 'document.summarize', 'doc.read'],
    evidence: 'document-reader/readers.ts handles TEXT/SHEET/OFFICE/IMAGE; caching + truncation.',
  },
  'pdf_extraction': {
    id: 'pdf_extraction', label: 'PDF / invoice text extraction', status: 'available',
    backedBy: ['document.read', 'document.read_many', 'document.summarize'],
    evidence: 'documents.rs document_extract_rich: Tier 1 pdf-extract decodes FlateDecode content streams + font encodings ($0 tokens); Tier 2 falls back to embedded page images (lopdf) read by the model vision. readers.ts routes the pdf branch; loop surfaces page images mid-task. docx/pptx via zip XML.',
    missingWork: 'Scanned fallback needs a vision-capable model; non-JPEG/exotic embedded image formats are skipped (uncertain fields should still be flagged).',
  },
  'sheet_io': {
    id: 'sheet_io', label: 'Spreadsheet read/write/append', status: 'available',
    backedBy: ['sheet.read', 'sheet.write', 'sheet.append', 'sheet.to_json'],
    evidence: 'executor.ts → Rust sheet_read/sheet_write for CSV/XLSX.',
  },
  'sheet_export': {
    id: 'sheet_export', label: 'Spreadsheet CSV export', status: 'available',
    backedBy: ['sheet.export_csv'],
    evidence: 'executor.ts sheet.export_csv reads rows and writes a quoted CSV file.',
  },
  'doc_write': {
    id: 'doc_write', label: 'Document write (txt/docx)', status: 'available',
    backedBy: ['doc.write_txt', 'doc.write_docx', 'file.write'],
    evidence: 'executor.ts doc.write_txt→file_write; doc.write_docx→Rust docx_write (with tables).',
  },
  'clipboard': {
    id: 'clipboard', label: 'Clipboard get/set', status: 'available',
    backedBy: ['clipboard.get', 'clipboard.set'],
    evidence: 'executor.ts clipboard.get/set; used for multi-cell TSV browser paste.',
  },

  // ── Orchestration / safety ───────────────────────────────────────────────
  'workflow_scheduling': {
    id: 'workflow_scheduling', label: 'Workflow blueprint + scheduling', status: 'partial',
    backedBy: ['workflow.start', 'workflow.status', 'workflow.cancel'],
    evidence: 'workflows/templates: reusable blueprints with steps/approval/verification and a scheduleCapable flag; workflow.start runs them.',
    missingWork: 'No always-on background cron/event scheduler executes blueprints unattended (Phase 3); blueprints are created and run on demand.',
  },
  'approval_policy': {
    id: 'approval_policy', label: 'Risk policy + approvals', status: 'available',
    backedBy: ['approval.request'],
    evidence: 'tools/policy.ts classifies risk; external_write/external_send/destructive/credential_access require approval; run.ts gates before execute. Autonomy modes manual/semi/full.',
  },
  'audit_redaction': {
    id: 'audit_redaction', label: 'Audit log + secret redaction', status: 'available',
    backedBy: ['approval.request'],
    evidence: 'tools/audit.ts sanitizeArgs/redactSecrets strip token/secret/password/api_key/bearer from args, output, errors before logging.',
  },
  'completion_verification': {
    id: 'completion_verification', label: 'Code-gated completion guard', status: 'available',
    backedBy: ['task.complete'],
    evidence: 'control-system/completion-guard.ts + goal-verifier.ts re-check evidence (read-backs, expected values) before accepting task.complete; rejects false completions.',
  },
  'recovery_after_failure': {
    id: 'recovery_after_failure', label: 'Failure recovery + manual handoff', status: 'available',
    backedBy: ['ask_user'],
    evidence: 'loop.ts fallback ladder, detectPageState blocker detection (login/captcha/permission), manual-blockers handoff message; single failures do not end the task.',
  },
  'final_summary_quality': {
    id: 'final_summary_quality', label: 'Final summary quality', status: 'available',
    backedBy: ['task.complete'],
    evidence: 'prompt completion checklist + verifier require what was done, verified, where output is; UI renders friendly step labels (chat.tsx TOOL_LABELS).',
    missingWork: 'Summary structure is prompt-guided, not schema-enforced — quality depends on the model.',
  },
} as const satisfies Record<string, CapabilityInfo>;

export type CapabilityId = keyof typeof CAPABILITY_MATRIX;

export function getCapability(id: CapabilityId): CapabilityInfo {
  return CAPABILITY_MATRIX[id];
}

export function allCapabilities(): CapabilityInfo[] {
  return Object.values(CAPABILITY_MATRIX);
}
