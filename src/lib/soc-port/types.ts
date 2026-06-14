export type SocPortMode = 'standard' | 'ocr' | 'labeled';

export type SocPortOperation =
  | { thought: string; operation: 'click'; x: string | number; y: string | number }
  | { thought: string; operation: 'click'; text: string }
  | { thought: string; operation: 'click'; label: string }
  | { thought: string; operation: 'write'; content: string }
  | { thought: string; operation: 'press'; keys: string[] }
  | { thought: string; operation: 'done'; summary: string };

export interface SocPortScreenshot {
  base64: string;
  width: number;
  height: number;
  monitorId: number;
}

export interface SocPortOcrItem {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
  source?: 'word' | 'group';
}

export interface SocPortLabelMap {
  labeledImageBase64: string;
  labelCoordinates: Record<string, [number, number, number, number]>;
}

export interface SocPortActionLog {
  thought: string;
  operation: SocPortOperation;
  success: boolean;
  output: string;
  error?: string;
  matchedText?: string;
  matchedLabel?: string;
  originalBbox?: [number, number, number, number];
  center?: { x: number; y: number };
  percent?: { x: number; y: number };
  source?: 'standard' | 'ocr' | 'label' | 'keyboard' | 'done';
}

export interface SocPortTurnLog {
  step: number;
  screenshot: SocPortScreenshot;
  after?: SocPortScreenshot;
  ocr: SocPortOcrItem[];
  labels?: SocPortLabelMap;
  model: string;
  rawModelOutput: string;
  actions: SocPortActionLog[];
}
