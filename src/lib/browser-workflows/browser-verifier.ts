// Verifies browser-task outcomes from the recorded actions/results. Used by the
// completion guard so "task.complete" on a browser/webapp task requires evidence
// (a state-changing action + a read-back), not just a browser.open.

import { detectPageState } from './detect-page-state';
import type { RecentAction } from '../agent-state/types';

const STATE_CHANGING = new Set([
  'browser.click', 'browser.type', 'browser.key', 'browser.paste',
  'browser.shortcut', 'browser.upload', 'browser.download',
]);
const READS = new Set(['browser.read', 'browser.get_state', 'browser.assert_text', 'browser.assert_url', 'browser.extract_table']);

export interface BrowserVerification {
  ok: boolean;
  reason: string;
  nextStepHint: string;
}

function lastRead(recent: RecentAction[]): RecentAction | undefined {
  for (let i = recent.length - 1; i >= 0; i--) {
    if (READS.has(recent[i].action) && recent[i].success) return recent[i];
  }
  return undefined;
}

/** Verify a browser task that only required opening a page. */
export function verifyOpenOnly(recent: RecentAction[]): BrowserVerification {
  const opened = recent.some((a) => a.action === 'browser.open' && a.success);
  const read = lastRead(recent);
  if (opened && read) {
    const st = detectPageState(read.output ?? '');
    if (st.isManualBlocker) {
      return { ok: false, reason: `Page shows a ${st.kind}.`, nextStepHint: 'ask_user to resolve the blocker, then resume.' };
    }
    return { ok: true, reason: 'Page opened and verified by read-back.', nextStepHint: '' };
  }
  if (opened) return { ok: false, reason: 'Page opened but not verified.', nextStepHint: 'browser.read to confirm the URL/title.' };
  return { ok: false, reason: 'Target page was never opened.', nextStepHint: 'browser.open the target URL.' };
}

/** Verify a browser task that required creating/changing content. */
export function verifyMutation(recent: RecentAction[]): BrowserVerification {
  const changed = recent.some((a) => STATE_CHANGING.has(a.action) && a.success);
  const read = lastRead(recent);
  if (!recent.some((a) => a.action === 'browser.open' && a.success)) {
    return { ok: false, reason: 'Target page was never opened.', nextStepHint: 'browser.open the target.' };
  }
  if (read) {
    const st = detectPageState(read.output ?? '');
    if (st.isManualBlocker) {
      return { ok: false, reason: `Page shows a ${st.kind}; the change cannot be confirmed.`, nextStepHint: 'ask_user to resolve the blocker, then resume.' };
    }
  }
  if (!changed) {
    return { ok: false, reason: 'Opening the page is not enough — no state-changing action succeeded.', nextStepHint: 'Perform the change (type/click/paste/upload), then read back.' };
  }
  if (!read) {
    return { ok: false, reason: 'A change was attempted but never verified.', nextStepHint: 'browser.read / browser.assert_text to confirm the change landed.' };
  }
  return { ok: true, reason: 'Change applied and confirmed by read-back.', nextStepHint: '' };
}
