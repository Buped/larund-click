import type { ControlAction } from './types';

const ALLOWED = new Set([
  // Layer 1: CLI
  'cli.run',
  // Layer 2: file / data I/O
  'file.read',
  'file.write',
  'file.list',
  'sheet.read',
  'sheet.write',
  'clipboard.get',
  'clipboard.set',
  // Layer 3: app launch
  'app.open',
  'window.list',
  'window.focus',
  // Layer 4: browser (CDP)
  'browser.open',
  'browser.read',
  'browser.click',
  'browser.type',
  'browser.key',
  'browser.wait',
  // Layer 5: native GUI element targeting (UIA)
  'ui.read',
  'ui.invoke',
  'ui.click',
  'ui.type',
  'ui.scroll',
  'ui.focusNext',
  'ui.activate',
  // Layer 6: keyboard
  'keyboard.press',
  'keyboard.combo',
  // Layer 7: SOC visual cursor control
  'soc.visual',
  // Control flow
  'task.complete',
  'ask_user',
]);

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}$/);
  if (match) return match[0];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

export function parseControlAction(text: string): ControlAction | null {
  const json = extractJson(text.replace(/```(?:json)?/g, '').replace(/```/g, '').trim());
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const action = String(raw.action ?? raw.tool ?? '');
  if (!ALLOWED.has(action)) return null;
  return { ...raw, action } as ControlAction;
}

export function isRawMouseActionName(name: string): boolean {
  return /^(mouse_click|mouse_double_click|mouse_move|mouse_drag|desktop_click_point|click_visual_target|ground_visual_target|desktop_visual_locate|visual\.clickIntent|visual\.typeIntent)$/.test(name);
}
