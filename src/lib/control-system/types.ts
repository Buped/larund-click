export type Point = [number, number];
export type BBox = [number, number, number, number];

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoordinateSpace {
  kind: 'screen' | 'region';
  origin: Point;
  width: number;
  height: number;
  dpiScale: number;
  monitorId: number;
}

export interface ScreenCapture {
  base64: string;
  width: number;
  height: number;
  monitorId: number;
  coordinateSpace: CoordinateSpace;
  region?: ScreenRegion;
}

export interface OcrWord {
  text: string;
  bbox: ScreenRegion;
  confidence: number;
}

export type CandidateSource = 'uia' | 'ocr' | 'ocr_group' | 'heuristic' | 'vlm_grid';

export interface TargetCandidate {
  id: string;
  source: CandidateSource;
  label: string;
  text: string;
  role: string;
  bbox: BBox;
  confidence: number;
  clickable: boolean;
  reasons: string[];
  metadata?: Record<string, unknown>;
}

export interface ScreenObservation {
  id: string;
  capture: ScreenCapture;
  activeWindowTitle: string;
  activeAppName: string;
  activeWindowRect?: ScreenRegion;
  candidates: TargetCandidate[];
  ocrWords: OcrWord[];
  providerLog: string[];
  timestamp: string;
}

export interface GridSpec {
  cellSize: number;
  origin: Point;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

export interface GridCell {
  id: string;
  col: number;
  row: number;
  bbox: BBox;
  center: Point;
}

export interface VisualGrounding {
  targetFound: boolean;
  cell?: GridCell;
  targetKind?: 'button' | 'card' | 'input' | 'text' | 'icon';
  visibleText?: string;
  confidence: number;
  reason: string;
  stage: 'coarse' | 'fine' | 'ultra' | 'local';
}

export interface VisualClickIntent {
  target: string;
  expected: string;
  app?: string;
  task?: string;
  userId?: string;
  addCost?: (usd: number) => void;
  maxAttempts?: number;
}

export interface VisualTypeIntent extends VisualClickIntent {
  text: string;
}

export interface VerifiedMouseTarget {
  label: string;
  bbox: BBox;
  clickPoint: Point;
  confidence: number;
  source: string;
  before: ScreenCapture;
  expectation: string;
  reasons: string[];
  coarseCell?: string;
  fineCell?: string;
}

export interface ClickVerification {
  verified: boolean;
  reason: string;
  diffRatio: number;
  stateMatched: boolean;
}

export interface VisualActionResult {
  success: boolean;
  target?: VerifiedMouseTarget;
  before?: ScreenObservation;
  after?: ScreenObservation;
  verification?: ClickVerification;
  attempts: number;
  error?: string;
  debugDir?: string;
}

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
  // ── Layer 5: native GUI element targeting (Windows UIA — no pixels) ────
  | { action: 'ui.read'; mode?: string }
  | { action: 'ui.invoke'; id: string; snapshot_token: string }
  | { action: 'ui.click'; id: string; snapshot_token: string }
  | { action: 'ui.type'; id: string; text: string; snapshot_token: string }
  | { action: 'ui.scroll'; id: string; direction: string; amount?: number; snapshot_token: string }
  | { action: 'ui.focusNext' }
  | { action: 'ui.activate' }
  // ── Layer 6: keyboard (focus-based) ───────────────────────────────────
  | { action: 'keyboard.press'; key: string }
  | { action: 'keyboard.combo'; keys: string[] }
  // ── Layer 7: SOC visual cursor control ────────────────────────────────
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
