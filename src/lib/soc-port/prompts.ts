import type { SocPortMode, SocPortOcrItem, SocPortTurnLog } from './types';

const STANDARD_PROMPT = `
You are operating a Windows computer, using the same operating system as a human.

From looking at the screen, the objective, and your previous actions, take the next best series of action.

You have 4 possible operation actions available to you. Larund's desktop executor will execute your decision. Your output will be used in a JSON.parse statement.

1. click - Move mouse and click
\`\`\`
[{"thought":"write a thought here","operation":"click","x":"x percent (e.g. 0.10)","y":"y percent (e.g. 0.13)"}]
\`\`\`

2. write - Write with your keyboard
\`\`\`
[{"thought":"write a thought here","operation":"write","content":"text to write here"}]
\`\`\`

3. press - Use a hotkey or press key to operate the computer
\`\`\`
[{"thought":"write a thought here","operation":"press","keys":["keys to use"]}]
\`\`\`

4. done - The objective is completed
\`\`\`
[{"thought":"write a thought here","operation":"done","summary":"summary of what was completed"}]
\`\`\`

Return the actions in array format []. You can take just one action or multiple actions.
`.trim();

const OCR_PROMPT = `
You are operating a Windows computer, using the same operating system as a human.

From looking at the screen, the objective, and your previous actions, take the next best series of action.

You have 4 possible operation actions available to you. Larund's desktop executor will execute your decision. Your output will be used in a JSON.parse statement.

1. click - Move mouse and click - Look for text to click. Try to find relevant text to click, but if there's nothing relevant enough you can return "nothing to click" for the text value and we'll try a different method.
\`\`\`
[{"thought":"write a thought here","operation":"click","text":"The text in the button or link to click"}]
\`\`\`

2. write - Write with your keyboard
\`\`\`
[{"thought":"write a thought here","operation":"write","content":"text to write here"}]
\`\`\`

3. press - Use a hotkey or press key to operate the computer
\`\`\`
[{"thought":"write a thought here","operation":"press","keys":["keys to use"]}]
\`\`\`

4. done - The objective is completed
\`\`\`
[{"thought":"write a thought here","operation":"done","summary":"summary of what was completed"}]
\`\`\`

Return the actions in array format []. You can take just one action or multiple actions.

A few important notes:
- Reflect on previous actions and the screenshot to ensure they align and that your previous actions worked.
- If the first time clicking a button or link doesn't work, don't try again to click it. Try something else such as clicking a different text or trying another action.
`.trim();

const LABELED_PROMPT = `
You are operating a Windows computer, using the same operating system as a human.

From looking at the screen, the objective, and your previous actions, take the next best series of action.

You have 4 possible operation actions available to you. Larund's desktop executor will execute your decision. Your output will be used in a JSON.parse statement.

1. click - Move mouse and click - We labeled the clickable elements with red bounding boxes and IDs. Label IDs are in the following format with x being a number: ~x
\`\`\`
[{"thought":"write a thought here","operation":"click","label":"~x"}]
\`\`\`

2. write - Write with your keyboard
\`\`\`
[{"thought":"write a thought here","operation":"write","content":"text to write here"}]
\`\`\`

3. press - Use a hotkey or press key to operate the computer
\`\`\`
[{"thought":"write a thought here","operation":"press","keys":["keys to use"]}]
\`\`\`

4. done - The objective is completed
\`\`\`
[{"thought":"write a thought here","operation":"done","summary":"summary of what was completed"}]
\`\`\`

Return the actions in array format []. You can take just one action or multiple actions.
`.trim();

export function buildSocPortSystemPrompt(mode: SocPortMode, objective: string): string {
  const base = mode === 'standard' ? STANDARD_PROMPT : mode === 'labeled' ? LABELED_PROMPT : OCR_PROMPT;
  return `${base}\n\nObjective: ${objective}`;
}

export function buildSocPortUserPrompt(args: {
  mode: SocPortMode;
  objective: string;
  history: SocPortTurnLog[];
  ocr: SocPortOcrItem[];
  labels?: Record<string, [number, number, number, number]>;
}): string {
  return JSON.stringify({
    objective: args.objective,
    mode: args.mode,
    previous_actions: args.history.slice(-6).flatMap((turn) => turn.actions.map((action) => ({
      operation: action.operation,
      success: action.success,
      output: action.output,
      error: action.error,
      matchedText: action.matchedText,
      matchedLabel: action.matchedLabel,
    }))),
    ocr_result: args.mode === 'ocr' ? args.ocr.map((item) => ({
      id: item.id,
      text: item.text,
      bbox: item.bbox,
      confidence: item.confidence,
    })) : undefined,
    label_coordinates: args.mode === 'labeled' ? args.labels : undefined,
    instruction: 'Please take the next best action. Only output JSON array format.',
  }, null, 2);
}
