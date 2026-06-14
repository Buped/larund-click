export type ControlAction =
  // ── Layer 1: CLI / shell ──────────────────────────────────────────────
  | { action: 'cli.run'; cmd: string; working_dir?: string }
  // ── Layer 2: file / data I/O (no GUI) ─────────────────────────────────
  | { action: 'file.read'; path: string }
  | { action: 'file.write'; path: string; content: string }
  | { action: 'file.list'; path: string }
  | { action: 'sheet.read'; path: string; sheet?: string; max_rows?: number }
  | { action: 'sheet.write'; path: string; sheet?: string; rows?: string[][]; start_cell?: string; mode?: string }
  | { action: 'clipboard.get' }
  | { action: 'clipboard.set'; text: string }
  // ── Layer 3: app launch ───────────────────────────────────────────────
  | { action: 'app.open'; name?: string; app_id?: string }
  | { action: 'window.list' }
  | { action: 'window.focus'; title: string }
  // ── Layer 4: browser (CDP, element-based — no pixels) ─────────────────
  | { action: 'browser.open'; url: string }
  | { action: 'browser.read' }
  | { action: 'browser.click'; target: string }
  | { action: 'browser.type'; target: string; text: string }
  | { action: 'browser.key'; key: string }
  | { action: 'browser.wait'; text?: string; seconds?: number }
  // ── Layer 5: keyboard (focus-based deterministic shortcuts) ───────────
  | { action: 'keyboard.press'; key: string }
  | { action: 'keyboard.combo'; keys: string[] }
  // ── Layer 6: Self-Operating Computer visual cursor control ────────────
  | { action: 'soc.visual'; objective?: string }
  // ── Control flow ──────────────────────────────────────────────────────
  | { action: 'task.complete'; summary: string }
  | { action: 'ask_user'; question: string };

export interface ControlToolResult {
  success: boolean;
  output: string;
  error?: string;
  screenshot?: { base64: string; width: number; height: number };
  details?: Record<string, unknown>;
}
