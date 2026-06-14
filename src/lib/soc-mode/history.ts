import type { SocFailureMemory, SocHistoryItem, SocOperation } from './types';
import { distance } from './coordinates';

export function createFailureMemory(): SocFailureMemory {
  return {
    failedClicks: [],
    failedTextClicks: [],
    failedLabels: [],
    forbiddenStrategies: [],
  };
}

export function isRepeatedFailedClick(
  failures: SocFailureMemory,
  point: { x: number; y: number },
  radius = 24,
): boolean {
  return failures.failedClicks.some((item) => distance(item, point) <= radius);
}

export function rememberFailedOperation(
  failures: SocFailureMemory,
  operation: SocOperation,
  step: number,
  reason: string,
  point?: { x: number; y: number },
): SocFailureMemory {
  const next: SocFailureMemory = {
    failedClicks: [...failures.failedClicks],
    failedTextClicks: [...failures.failedTextClicks],
    failedLabels: [...failures.failedLabels],
    forbiddenStrategies: [...failures.forbiddenStrategies],
  };
  if (point) next.failedClicks.push({ x: point.x, y: point.y, reason, step });
  if (operation.operation === 'click_text') {
    next.failedTextClicks.push({ text: operation.text, reason, step });
  }
  if (operation.operation === 'click_label') {
    next.failedLabels.push({ label: operation.label, reason, step });
  }
  return next;
}

export function shouldBlockDone(history: SocHistoryItem[], task: string, summary: string): string | null {
  const hasInteraction = history.some((item) => ['click', 'click_text', 'click_label', 'write', 'press'].includes(item.operation.operation));
  if (!hasInteraction) return 'done_before_any_visual_interaction';
  const last = history[history.length - 1];
  if (!last?.after) return 'done_without_after_screenshot';
  const lowered = `${task}\n${summary}`.toLowerCase();
  if (lowered.includes('roblox')) {
    const launchedOnly = /open|opened|launch|launched|started/.test(summary.toLowerCase())
      && !/game|detail|loading|playing|joined|entered|ground war/.test(summary.toLowerCase());
    if (launchedOnly) return 'roblox_app_launch_is_not_completion';
  }
  return null;
}
