export type SocMode = 'standard' | 'ocr' | 'labeled' | 'hybrid-ocr-labeled';

export type SocOperation =
  | { thought: string; operation: 'click'; x: string | number; y: string | number }
  | { thought: string; operation: 'click_text'; text: string }
  | { thought: string; operation: 'click_label'; label: string }
  | { thought: string; operation: 'write'; content: string }
  | { thought: string; operation: 'press'; keys: string[] }
  | { thought: string; operation: 'wait'; ms?: number }
  | { thought: string; operation: 'ask_user'; question: string }
  | { thought: string; operation: 'done'; summary: string };

export interface SocScreenshot {
  base64: string;
  width: number;
  height: number;
  monitorId: number;
}

export interface SocOcrBox {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface SocLabelBox {
  label: string;
  bbox: [number, number, number, number];
  source: 'ocr' | 'visual';
  text?: string;
  description?: string;
}

export interface SocLabelOverlay {
  imageBase64: string;
  labels: SocLabelBox[];
}

export interface SocFailureMemory {
  failedClicks: Array<{ x: number; y: number; reason: string; step: number }>;
  failedTextClicks: Array<{ text: string; reason: string; step: number }>;
  failedLabels: Array<{ label: string; reason: string; step: number }>;
  forbiddenStrategies: string[];
}

export interface SocExecutionLog {
  operation: SocOperation['operation'];
  thought: string;
  success: boolean;
  output: string;
  error?: string;
  source?: 'percent' | 'ocr' | 'label' | 'keyboard' | 'wait' | 'done' | 'ask_user';
  original?: unknown;
  pixel?: { x: number; y: number };
  screen?: { x: number; y: number };
  screenshotSize?: { width: number; height: number };
  screenSize?: { width: number; height: number };
  noChange?: boolean;
}

export interface SocHistoryItem {
  step: number;
  before?: SocScreenshot;
  after?: SocScreenshot;
  ocrCount: number;
  labelCount: number;
  model: string;
  operation: SocOperation;
  result: SocExecutionLog;
  rawModelOutput?: string;
}

export interface SocTurnContext {
  task: string;
  step: number;
  mode: SocMode;
  model: string;
  screenshot: SocScreenshot;
  ocr: SocOcrBox[];
  labels: SocLabelBox[];
  labeledScreenshotBase64: string;
  history: SocHistoryItem[];
  failures: SocFailureMemory;
}

export interface SocLoopCallbacks {
  onStep?: (step: {
    type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error';
    tool?: string;
    input?: string;
    output?: string;
    error?: string;
    screenshotBase64?: string;
    details?: Record<string, unknown>;
  }) => void;
  onAskUser?: (question: string) => Promise<string>;
  addCost?: (usd: number) => void;
}
