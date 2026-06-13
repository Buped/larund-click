// Vision Mouse V2 — unified data model.
//
// These types are the single contract between the perception layer (providers
// that describe the screen), the planner (the LLM that chooses an action), the
// executor (that performs it the most stable way available), and the verifier.
//
// Coordinate convention for `bbox`: [x1, y1, x2, y2] in ABSOLUTE screen pixels
// (top-left origin). `center` / `clickable_point`: [x, y] absolute screen px.
// All coordinate conversions live in coordinates.ts — never inline them.

/** [x1, y1, x2, y2] — absolute screen pixels, inclusive top-left / exclusive bottom-right. */
export type BBox = [number, number, number, number];

/** [x, y] — absolute screen pixels. */
export type Point = [number, number];

/** Where a ScreenElement came from. Drives merge priority (see merge.ts). */
export type ElementSource =
  | 'dom'        // Playwright/CDP DOM element (most reliable)
  | 'uia'        // Windows UI Automation element
  | 'ocr'        // OCR text box
  | 'omniparser' // visual parser / Set-of-Mark label
  | 'vision'     // generic CV detector
  | 'grid'       // legacy grid fallback
  | 'manual';    // injected by code/tests

/** Source priority for the merger: lower index = higher priority. */
export const SOURCE_PRIORITY: ElementSource[] = [
  'dom', 'uia', 'ocr', 'omniparser', 'vision', 'grid', 'manual',
];

export interface ScreenElement {
  id: string;
  source: ElementSource;
  role: string;
  name: string;
  text: string;
  description?: string;
  bbox: BBox;
  center: Point;
  /** Best point to click — UIA ClickablePoint, glyph inset, or computed safe point. */
  clickable_point: Point;
  clickable: boolean;
  /** 0..1 — confidence that this element is real and targetable. */
  confidence: number;
  visible: boolean;
  /** Higher = nearer the front, when derivable. */
  z_index?: number;
  /**
   * Source-specific payload the executor needs to act WITHOUT the mouse, e.g.
   * a DOM selector/text, a UIA snapshot_token + target id + invoke capability.
   */
  metadata?: Record<string, unknown>;
}

export type ActionType =
  | 'cli_command'   // shell command (launch app, file/git/npm/cargo/powershell …)
  | 'browser_open'  // navigate the agent's CDP browser to a URL
  | 'click_element'
  | 'click_text'
  | 'click_label'
  | 'hotkey'
  | 'type_text'
  | 'scroll'
  | 'raw_click'
  | 'wait'
  | 'done'
  | 'ask_user';

export type VerificationType =
  | 'text_appears'
  | 'text_disappears'
  | 'window_changed'
  | 'panel_opened'
  | 'url_changed'
  | 'focus_changed'
  | 'visual_change'
  | 'llm_check'
  | 'none';

export interface VerificationSpec {
  type: VerificationType;
  value?: string;
  timeout_ms?: number;
  required?: boolean;
}

export interface ActionTarget {
  element_id?: string;
  /** For click_text / click_label when no element_id is chosen. */
  text?: string;
  /** Raw screen-pixel fallback (raw_click only). */
  x?: number;
  y?: number;
}

export interface ActionPlan {
  action: ActionType;
  target?: ActionTarget;
  /** cli_command payload. */
  command?: string;
  working_dir?: string;
  /** browser_open payload. */
  url?: string;
  /** type_text payload, or the text/label to click. */
  text?: string;
  /** type_text: clear the field (Ctrl+A, Delete) before typing. */
  clear_before_typing?: boolean;
  /** type_text: press Enter after typing. */
  press_enter?: boolean;
  /** hotkey payload, e.g. ["ctrl","shift","x"]. */
  keys?: string[];
  /** scroll direction. */
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  /** wait payload (ms). */
  timeout_ms?: number;
  /** ask_user / done payload. */
  question?: string;
  summary?: string;
  reason: string;
  confidence: number;
  expect?: VerificationSpec;
}

/** How an action was ultimately carried out (for logging + escalation). */
export type UsedMethod =
  | 'cli'
  | 'browser'
  | 'dom'
  | 'uia_invoke'
  | 'uia_value'
  | 'keyboard'
  | 'hotkey'
  | 'mouse_safe_point'
  | 'mouse_refined_point'  // Precision V3 — clicked a crop/region-refined point
  | 'mouse_raw'
  | 'fallback'
  | 'none';

/** Observed CLI result, carried in HybridState into the next planner step. */
export interface CliObservation {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VerificationResult {
  verified: boolean;
  type: VerificationType;
  detail?: string;
}

export interface ActionResult {
  success: boolean;
  action_executed: ActionType;
  used_method: UsedMethod;
  before_screenshot?: string;
  after_screenshot?: string;
  error?: string;
  verification?: VerificationResult;
}

export interface ScreenMetrics {
  screen_width: number;
  screen_height: number;
  dpi_scale: number;
}

export interface ScreenshotMetrics {
  screenshot_width: number;
  screenshot_height: number;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenState {
  screenshot_path?: string;
  screenshot_base64?: string;
  screenshot_width: number;
  screenshot_height: number;
  screen_width: number;
  screen_height: number;
  dpi_scale: number;
  active_window_title: string;
  active_app_name: string;
  active_window_rect?: WindowRect;
  /** Active browser page URL, when a DOM context was read. */
  browser_url?: string;
  elements: ScreenElement[];
  timestamp: string;
  /** Paths/identifiers of saved debug artifacts (overlays, before/after). */
  debug_artifacts?: Record<string, string>;
}
