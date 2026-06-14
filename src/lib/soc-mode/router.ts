import type { ControlAction } from '../control-system/types';

export type HighLevelMode = 'cli' | 'soc_visual';

const VISUAL_HINTS = /\b(click|mouse|cursor|screen|gui|desktop|roblox|game|launcher|button|card|open .* and (select|click|enter|choose)|katt|eg[ée]r|kurzor|képerny|játék|gomb)\b/i;

export function routeHighLevel(task: string, lastAction?: ControlAction, lastResultOutput = ''): HighLevelMode {
  if (lastAction?.action === 'app.open') return 'soc_visual';
  if (/verified|opened|launched|app_open/i.test(lastResultOutput) && VISUAL_HINTS.test(task)) return 'soc_visual';
  if (VISUAL_HINTS.test(task)) return 'soc_visual';
  return 'cli';
}

export function isDeterministicControlAction(action: ControlAction): boolean {
  return action.action.startsWith('cli.')
    || action.action.startsWith('file.')
    || action.action.startsWith('sheet.')
    || action.action.startsWith('clipboard.')
    || action.action.startsWith('browser.')
    || action.action === 'app.open'
    || action.action === 'window.list'
    || action.action === 'window.focus'
    || action.action === 'keyboard.press'
    || action.action === 'keyboard.combo'
    || action.action === 'ask_user'
    || action.action === 'task.complete'
    || action.action === 'soc.visual';
}
