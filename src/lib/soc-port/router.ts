import type { ControlAction } from '../control-system/types';

export type HighLevelMode = 'cli' | 'soc_visual';

const VISUAL_HINTS = /\b(click|mouse|cursor|screen|gui|desktop|roblox|game|launcher|button|card|notepad|jegyzett|katt|eg[ée]r|kurzor|képerny|játék|gomb)\b/i;

export function routeHighLevel(task: string, lastAction?: ControlAction, lastResultOutput = ''): HighLevelMode {
  if (lastAction?.action === 'app.open') return 'soc_visual';
  if (/verified|opened|launched|app_open/i.test(lastResultOutput) && VISUAL_HINTS.test(task)) return 'soc_visual';
  if (VISUAL_HINTS.test(task)) return 'soc_visual';
  return 'cli';
}
