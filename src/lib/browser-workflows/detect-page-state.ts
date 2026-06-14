// Parses a browser.read / browser.get_state output (the "URL: …\nTITLE: …\n…"
// blob produced by src-tauri browser_read) into a structured PageState.

import { detectManualBlocker } from './manual-blockers';
import type { PageState } from './types';

function field(text: string, label: string): string | undefined {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  return m?.[1]?.trim();
}

export function detectPageState(readOutput: string): PageState {
  const text = readOutput ?? '';
  const url = field(text, 'URL');
  const title = field(text, 'TITLE');

  const blocker = detectManualBlocker(text);
  if (blocker.blocked) {
    return {
      kind: blocker.kind ?? 'login_required',
      url,
      title,
      signals: blocker.signals,
      isManualBlocker: true,
    };
  }

  // Heuristic "ready" detection: a real app surface usually exposes inputs/buttons.
  const looksInteractive = /CLICKABLE\/INPUTS:/i.test(text) && /(input|button|textbox|grid|cell)/i.test(text);
  return {
    kind: looksInteractive ? 'webapp_ready' : 'loaded',
    url,
    title,
    signals: [],
    isManualBlocker: false,
  };
}
