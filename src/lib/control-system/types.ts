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

  // ── Data: spreadsheets ────────────────────────────────────────────────
  | { action: 'sheet.read'; path: string; sheet?: string; max_rows?: number }
  | { action: 'sheet.write'; path: string; sheet?: string; rows?: string[][]; start_cell?: string; mode?: 'overwrite' | 'append' }

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
  | { action: 'browser.open'; url: string; profile?: string }
  | { action: 'browser.read'; selector?: string }
  | { action: 'browser.click'; target: string }
  | { action: 'browser.type'; target: string; text: string }
  | { action: 'browser.key'; key: string }
  | { action: 'browser.wait'; text?: string; selector?: string; seconds?: number }
  | { action: 'browser.extract_table'; selector?: string }
  | { action: 'browser.download'; url?: string; target?: string; save_as?: string }
  | { action: 'browser.upload'; target: string; path: string }

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
