import { callOpenRouterWithTools, type MessageContent } from '../openrouter';
import type { GridCell, GridSpec, ScreenCapture, TargetCandidate, VisualGrounding } from './types';
import { getCell } from './grid';

export const QWEN_GRID_MODEL = 'qwen/qwen3-vl-32b-instruct';
export const QWEN_GRID_FALLBACK_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct';

interface RawGridGrounding {
  target_found?: boolean;
  cell?: string;
  target_kind?: string;
  visible_text?: string;
  confidence?: number;
  reason?: string;
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseGridGrounding(rawText: string, grid: GridSpec, stage: VisualGrounding['stage']): VisualGrounding {
  const json = extractJson(rawText);
  if (!json) return { targetFound: false, confidence: 0, reason: 'invalid_json', stage };
  let raw: RawGridGrounding;
  try {
    raw = JSON.parse(json) as RawGridGrounding;
  } catch {
    return { targetFound: false, confidence: 0, reason: 'invalid_json', stage };
  }
  if (raw.target_found !== true) {
    return { targetFound: false, confidence: 0, reason: raw.reason ?? 'target_not_found', stage };
  }
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { targetFound: false, confidence: 0, reason: 'invalid_confidence', stage };
  }
  const cell = raw.cell ? getCell(grid, raw.cell) : null;
  if (!cell) return { targetFound: false, confidence, reason: 'invalid_cell', stage };
  const kind = ['button', 'card', 'input', 'text', 'icon'].includes(String(raw.target_kind))
    ? raw.target_kind as VisualGrounding['targetKind']
    : undefined;
  return {
    targetFound: true,
    cell,
    targetKind: kind,
    visibleText: raw.visible_text ?? '',
    confidence,
    reason: raw.reason ?? 'grid_grounding',
    stage,
  };
}

async function callGridModel(
  model: string,
  imageBase64: string,
  grid: GridSpec,
  target: string,
  expected: string,
  userId: string,
  addCost: (usd: number) => void,
  stage: VisualGrounding['stage'],
): Promise<VisualGrounding> {
  let response = '';
  let error = '';
  const content: MessageContent = [
    {
      type: 'text',
      text: [
        'You are a GUI visual grounding model. Choose a grid CELL, not pixel coordinates.',
        `Target: ${target}`,
        `Expected after action: ${expected}`,
        `Grid origin: (${grid.origin[0]}, ${grid.origin[1]}), cell_size=${grid.cellSize}, cols=${grid.cols}, rows=${grid.rows}.`,
        'Return JSON only: {"target_found":true,"cell":"M17","target_kind":"button|card|input|text|icon","visible_text":"...","confidence":0.0,"reason":"..."}',
        'If unsure, return {"target_found":false,"confidence":0,"reason":"..."}',
      ].join('\n'),
    },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
  ];
  await callOpenRouterWithTools(
    [{ role: 'system', content: 'Return strict JSON only. Never return x/y pixels.' }, { role: 'user', content }],
    model,
    userId,
    (chunk) => { response += chunk; },
    (usage) => addCost(usage.costUsd),
    (err) => { error = err; },
    false,
  );
  if (error) return { targetFound: false, confidence: 0, reason: error, stage };
  return parseGridGrounding(response, grid, stage);
}

export async function groundGridWithQwen(args: {
  imageBase64: string;
  capture: ScreenCapture;
  grid: GridSpec;
  target: string;
  expected: string;
  userId?: string;
  addCost?: (usd: number) => void;
  allowFallback?: boolean;
  stage?: VisualGrounding['stage'];
}): Promise<VisualGrounding> {
  const stage = args.stage ?? 'coarse';
  if (!args.userId || !args.addCost) return { targetFound: false, confidence: 0, reason: 'qwen_unavailable_no_user', stage };
  const primary = await callGridModel(QWEN_GRID_MODEL, args.imageBase64, args.grid, args.target, args.expected, args.userId, args.addCost, stage);
  if (primary.targetFound && primary.confidence >= 0.75) return primary;
  if (args.allowFallback === false) return primary;
  const fallback = await callGridModel(QWEN_GRID_FALLBACK_MODEL, args.imageBase64, args.grid, args.target, args.expected, args.userId, args.addCost, stage);
  return fallback.targetFound ? fallback : primary;
}

export function groundingToCandidate(cell: GridCell, grounding: VisualGrounding, target: string): TargetCandidate {
  return {
    id: `grid_${grounding.stage}_${cell.id}`,
    source: 'vlm_grid' as const,
    label: grounding.visibleText || target,
    text: grounding.visibleText || target,
    role: grounding.targetKind || 'button',
    bbox: cell.bbox,
    confidence: grounding.confidence,
    clickable: true,
    reasons: ['qwen_grid_cell', grounding.reason],
    metadata: { cell: cell.id, stage: grounding.stage },
  };
}
