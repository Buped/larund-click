// Goal verifier — the evidence engine behind the completion guard. Given the
// active task and the actions that actually ran, it decides whether the requested
// outcome is *proven*. It never trusts the model's "I'm done"; it checks reality.

import type { ActiveTaskState, RecentAction } from '../agent-state/types';
import { verifyMutation, verifyOpenOnly } from '../browser-workflows/browser-verifier';
import { detectPageState } from '../browser-workflows/detect-page-state';

export interface Verification {
  ok: boolean;
  reason: string;
  nextStepHint: string;
}

const MUTATING = new Set([
  'file.write', 'file.edit', 'file.mkdir', 'file.copy', 'file.move', 'file.delete',
  'sheet.write', 'cli.run',
]);
const FILE_READS = new Set(['file.list', 'file.exists', 'file.tree', 'file.metadata', 'file.read', 'sheet.read']);
const DOCUMENT_READS = new Set(['document.read', 'document.read_many', 'folder.read_relevant', 'doc.read']);

function succeeded(recent: RecentAction[], action: string): boolean {
  return recent.some((a) => a.action === action && a.success);
}
function anySucceeded(recent: RecentAction[], actions: Set<string>): boolean {
  return recent.some((a) => actions.has(a.action) && a.success);
}
function lastSuccess(recent: RecentAction[], actions: Set<string>): number {
  for (let i = recent.length - 1; i >= 0; i--) {
    if (actions.has(recent[i].action) && recent[i].success) return i;
  }
  return -1;
}

/** A cloud Google Sheet is only done with real, verified data in the online grid. */
function verifyCloudSheet(recent: RecentAction[]): Verification {
  // A local sheet.write NEVER satisfies a cloud sheet task.
  const onlyLocal = succeeded(recent, 'sheet.write') &&
    !anySucceeded(recent, new Set(['browser.paste', 'browser.shortcut', 'browser.type', 'connection.call']));
  if (onlyLocal) {
    return {
      ok: false,
      reason: 'A local spreadsheet file does not satisfy a Google Sheets (web) task.',
      nextStepHint: 'Write into the online sheet via the browser (clipboard TSV paste) or a Google connection, then verify.',
    };
  }

  // Connection path: a successful Google Sheets write through a connection.
  const connWrite = recent.some(
    (a) => a.action === 'connection.call' && a.success && /sheets?\.(write|append|update|create)/i.test(a.argsSummary ?? ''),
  );
  const connRead = recent.some(
    (a) => a.action === 'connection.call' && a.success && /sheets?\.(read|get_metadata|read_values)/i.test(a.argsSummary ?? ''),
  );
  if (connWrite && connRead) return { ok: true, reason: 'Google Sheets connection wrote and read back the sheet.', nextStepHint: '' };
  if (connWrite && !connRead) {
    return {
      ok: false,
      reason: 'Google Sheets was written through the connection but not read back.',
      nextStepHint: 'Call google.sheets.read_values or get_metadata to verify rows/header presence.',
    };
  }

  // Browser path: a paste/type into the grid + a read-back that is not a login wall.
  const wrote = anySucceeded(recent, new Set(['browser.paste', 'browser.shortcut', 'browser.type']));
  const read = lastSuccess(recent, new Set(['browser.read', 'browser.get_state', 'browser.assert_text']));
  if (!succeeded(recent, 'browser.open')) {
    return { ok: false, reason: 'The Google Sheet was never opened.', nextStepHint: 'browser.open https://sheets.new' };
  }
  if (read >= 0) {
    const st = detectPageState(recent[read].output ?? '');
    if (st.isManualBlocker) {
      return { ok: false, reason: `The sheet is behind a ${st.kind}.`, nextStepHint: 'ask_user to log in, then resume populating the sheet.' };
    }
  }
  if (!wrote) {
    return { ok: false, reason: 'The online sheet is still empty — no paste/type into the grid succeeded.', nextStepHint: 'Set the clipboard to TSV and browser.paste into A1, then read back.' };
  }
  if (read < 0) {
    return { ok: false, reason: 'Data was sent but never verified in the online sheet.', nextStepHint: 'browser.read / browser.assert_text to confirm the rows are present.' };
  }
  return { ok: true, reason: 'Data pasted into the online sheet and confirmed by read-back.', nextStepHint: '' };
}

function verifyLocalSheet(recent: RecentAction[]): Verification {
  if (!succeeded(recent, 'sheet.write') && !succeeded(recent, 'file.write')) {
    return { ok: false, reason: 'No spreadsheet file was written.', nextStepHint: 'sheet.write the .xlsx/.csv file.' };
  }
  if (!anySucceeded(recent, new Set(['sheet.read', 'file.exists', 'file.read']))) {
    return { ok: false, reason: 'The written file was not read back / confirmed.', nextStepHint: 'sheet.read or file.exists to confirm the rows.' };
  }
  return { ok: true, reason: 'Local spreadsheet written and confirmed by read-back.', nextStepHint: '' };
}

function verifyDocumentAccounting(recent: RecentAction[], cloudTarget: boolean): Verification {
  if (!anySucceeded(recent, DOCUMENT_READS) && !succeeded(recent, 'file.read')) {
    return {
      ok: false,
      reason: 'The source documents were not read before accounting output was created.',
      nextStepHint: 'Use document.read/read_many or folder.read_relevant on the referenced invoices first.',
    };
  }
  return cloudTarget ? verifyCloudSheet(recent) : verifyLocalSheet(recent);
}

function verifyFileOps(recent: RecentAction[]): Verification {
  if (!anySucceeded(recent, MUTATING)) {
    return { ok: false, reason: 'No file operation was performed.', nextStepHint: 'Perform the requested file operations.' };
  }
  const lastMutate = lastSuccess(recent, MUTATING);
  const lastRead = lastSuccess(recent, FILE_READS);
  if (lastRead < lastMutate) {
    return { ok: false, reason: 'Final file state was not verified after the last change.', nextStepHint: 'file.list / file.exists / file.tree to confirm the final state.' };
  }
  return { ok: true, reason: 'File operations performed and final state confirmed.', nextStepHint: '' };
}

/**
 * The single entry point. Decides whether a task.complete is justified by the
 * evidence in `recent`. Surface-specific where it matters; otherwise it just
 * insists that *some* real action ran and was read back.
 */
export function verifyCompletion(state: ActiveTaskState, recent: RecentAction[]): Verification {
  // Guard against instant completion with no real work at all.
  const realWork = recent.some((a) => !['task.complete', 'ask_user', 'approval.request'].includes(a.action));
  if (!realWork) {
    return { ok: false, reason: 'No tool action has run yet.', nextStepHint: 'Use a structured tool to actually do the work first.' };
  }

  const wantsAccounting = /invoice|sz[áa]mla|accounting|k[oö]nyvel/i.test(`${state.originalUserGoal} ${state.currentGoal}`);
  if (wantsAccounting && (state.intent === 'spreadsheet_cloud' || state.targetDocument?.type === 'google_sheet')) {
    return verifyDocumentAccounting(recent, true);
  }
  if (wantsAccounting && (state.intent === 'spreadsheet_local' || /xlsx|excel|csv/i.test(state.originalUserGoal))) {
    return verifyDocumentAccounting(recent, false);
  }

  switch (state.intent) {
    case 'spreadsheet_cloud':
      return verifyCloudSheet(recent);
    case 'spreadsheet_local':
      return verifyLocalSheet(recent);
    case 'file_ops':
      return verifyFileOps(recent);
    case 'browser_webapp':
      return state.expectedOutcome && /opening the page alone is not enough|reflects the requested change/i.test(state.expectedOutcome)
        ? verifyMutation(recent)
        : verifyOpenOnly(recent);
    default: {
      // Lenient default: require at least one successful non-control action.
      const okAny = recent.some((a) => a.success && !['task.complete', 'ask_user', 'approval.request'].includes(a.action));
      return okAny
        ? { ok: true, reason: 'At least one verifying action succeeded.', nextStepHint: '' }
        : { ok: false, reason: 'No successful action proves the outcome.', nextStepHint: 'Perform and verify the requested work.' };
    }
  }
}
