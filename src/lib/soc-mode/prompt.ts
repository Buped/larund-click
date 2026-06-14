import type { SocMode, SocTurnContext } from './types';

const COMMON_RULES = `
You are operating a Windows computer like a human. Larund's deterministic desktop executor will execute your decision.
From the current screen, the objective, and previous actions, choose the next best action.
Return only a valid JSON array. No markdown, no explanation outside JSON.
Reflect on previous actions and the screenshot. If a button/link click did not work, do not repeat the same click; try a different grounded strategy.
The user may write Hungarian or English. Keep the JSON schema stable in English.
Do not mark done unless the latest screenshot shows the requested goal state, not merely that an app opened.
`.trim();

const OP_SCHEMA = `
Allowed operations:
1. click: {"thought":"...","operation":"click","x":"0.10","y":"0.13"} where x/y are screen percentages from 0.0 to 1.0.
2. click_text: {"thought":"...","operation":"click_text","text":"visible OCR text to click"}
3. click_label: {"thought":"...","operation":"click_label","label":"~12"}
4. write: {"thought":"...","operation":"write","content":"text to type"}
5. press: {"thought":"...","operation":"press","keys":["ctrl","l"]}
6. wait: {"thought":"...","operation":"wait","ms":1000}
7. ask_user: {"thought":"...","operation":"ask_user","question":"short question"}
8. done: {"thought":"...","operation":"done","summary":"what is visibly complete"}
`.trim();

export function buildSocSystemPrompt(mode: SocMode): string {
  const modeRule = {
    standard: 'Use screenshot understanding. Prefer press/write when they are safer than clicking. Raw click is allowed with percent coordinates.',
    ocr: 'You also receive an OCR text map. Prefer click_text for visible text. Raw click is only a fallback.',
    labeled: 'You see a labeled screenshot with red boxes. Prefer click_label for visible targets. Raw click is only a fallback.',
    'hybrid-ocr-labeled': 'You receive screenshot, OCR text map, and label map. Prefer click_text first, then click_label, then press/write. Raw click is last resort.',
  }[mode];

  return `${COMMON_RULES}\n\n${modeRule}\n\n${OP_SCHEMA}\n\nExample:\n[{"thought":"I can see the Roblox home screen and the Ground War card in Continue. I will click the grounded text.","operation":"click_text","text":"Ground War"}]`;
}

export function buildSocUserPrompt(ctx: SocTurnContext): string {
  const previous = ctx.history.slice(-8).map((item) => ({
    step: item.step,
    operation: item.operation,
    result: item.result.output || item.result.error,
    noChange: item.result.noChange ?? false,
  }));
  const ocrMap = ctx.ocr.slice(0, 140).map((box) => ({
    id: box.id,
    text: box.text,
    bbox: box.bbox,
    confidence: box.confidence,
  }));
  const labelMap = ctx.labels.slice(0, 180).map((box) => ({
    label: box.label,
    bbox: box.bbox,
    source: box.source,
    text: box.text,
    description: box.description,
  }));

  return JSON.stringify({
    objective: ctx.task,
    step: ctx.step,
    mode: ctx.mode,
    screenshot: { width: ctx.screenshot.width, height: ctx.screenshot.height },
    previous_actions: previous,
    ocr_text_map: ctx.mode === 'standard' || ctx.mode === 'labeled' ? [] : ocrMap,
    label_map: ctx.mode === 'standard' || ctx.mode === 'ocr' ? [] : labelMap,
    failure_memory: ctx.failures,
    instruction: 'Choose the next best SOC operation. Return only a JSON array.',
  }, null, 2);
}
