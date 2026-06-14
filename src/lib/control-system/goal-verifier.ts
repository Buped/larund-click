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

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function expectedValues(state: ActiveTaskState): string[] {
  const direct = state.expectedData?.values ?? state.expectedData?.rows?.flat() ?? [];
  const fromArtifacts = state.expectedArtifacts?.flatMap((a) => a.values ?? a.rows?.flat() ?? []) ?? [];
  return [...direct, ...fromArtifacts].map((v) => String(v).trim()).filter(Boolean);
}

function outputContainsExpected(output: string | undefined, expected: string[], minMatches: number): boolean {
  if (!output || expected.length === 0) return false;
  const hay = normalizeText(output);
  const values = [...new Set(expected.map(normalizeText).filter(Boolean))];
  const matches = values.filter((v) => hay.includes(v)).length;
  return matches >= Math.min(minMatches, values.length);
}

function readbackHasRows(output: string | undefined): boolean {
  if (!output) return false;
  try {
    const parsed = JSON.parse(output) as { values?: unknown[]; rowCount?: number; row_count?: number };
    if (typeof parsed.rowCount === 'number' && parsed.rowCount > 0) return true;
    if (typeof parsed.row_count === 'number' && parsed.row_count > 0) return true;
    if (Array.isArray(parsed.values) && parsed.values.length > 0) return true;
  } catch {
    // Plain text is handled below.
  }
  return output.trim().length > 8 && !/^\s*(ok|true|success)\s*$/i.test(output);
}

/** A cloud Google Sheet is only done with real, verified data in the online grid. */
function verifyCloudSheet(state: ActiveTaskState, recent: RecentAction[]): Verification {
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

  // Connection path: a write must be followed by a values read-back.
  const connWrite = recent.some(
    (a) => a.action === 'connection.call' && a.success && /google\.sheets\.(write_values|append_values)/i.test(a.argsSummary ?? ''),
  );
  const connRead = [...recent].reverse().find(
    (a) => a.action === 'connection.call' && a.success && /google\.sheets\.read_values/i.test(a.argsSummary ?? ''),
  );
  const expected = expectedValues(state);
  if (connWrite && connRead) {
    if (expected.length > 0 && !outputContainsExpected(connRead.output, expected, 2)) {
      return {
        ok: false,
        reason: 'Google Sheets read-back does not contain the expected written values.',
        nextStepHint: 'Read the sheet values again and compare them with the rows you wrote.',
      };
    }
    if (expected.length === 0 && !readbackHasRows(connRead.output)) {
      return {
        ok: false,
        reason: 'Google Sheets read-back did not prove that rows are present.',
        nextStepHint: 'Read a populated range with google.sheets.read_values.',
      };
    }
    return { ok: true, reason: 'Google Sheets connection wrote and read back matching values.', nextStepHint: '' };
  }
  if (connWrite && !connRead) {
    return {
      ok: false,
      reason: 'Google Sheets was written through the connection but not read back.',
      nextStepHint: 'Call google.sheets.read_values to verify rows/header presence.',
    };
  }

  // Browser path: paste/type is not proof. Require concrete cell evidence.
  const wrote = anySucceeded(recent, new Set(['browser.paste', 'browser.shortcut', 'browser.type']));
  const read = lastSuccess(recent, new Set(['browser.read', 'browser.get_state']));
  const contentProof = [...recent].reverse().find(
    (a) => a.success && ['browser.assert_text', 'browser.extract_table', 'browser.download', 'sheet.read', 'file.read'].includes(a.action),
  );
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
  if (!contentProof) {
    return {
      ok: false,
      reason: 'Data was sent to the browser, but no reliable cell-content proof was captured.',
      nextStepHint: 'Use browser.assert_text for concrete cell values, browser.extract_table, export/read a file, or connect Google Workspace.',
    };
  }
  if (expected.length > 0 && !outputContainsExpected(contentProof.output, expected, 2)) {
    return {
      ok: false,
      reason: 'Browser verification did not contain enough expected cell values.',
      nextStepHint: 'Assert at least 2-3 concrete values from the rows you wrote, or use Google Sheets API read-back.',
    };
  }
  return { ok: true, reason: 'Online Google Sheet contents were verified with concrete cell evidence.', nextStepHint: '' };
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

function verifyDocumentAccounting(state: ActiveTaskState, recent: RecentAction[], cloudTarget: boolean): Verification {
  if (!anySucceeded(recent, DOCUMENT_READS) && !succeeded(recent, 'file.read')) {
    return {
      ok: false,
      reason: 'The source documents were not read before accounting output was created.',
      nextStepHint: 'Use document.read/read_many or folder.read_relevant on the referenced invoices first.',
    };
  }
  return cloudTarget ? verifyCloudSheet(state, recent) : verifyLocalSheet(recent);
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
    return verifyDocumentAccounting(state, recent, true);
  }
  if (wantsAccounting && (state.intent === 'spreadsheet_local' || /xlsx|excel|csv/i.test(state.originalUserGoal))) {
    return verifyDocumentAccounting(state, recent, false);
  }

  switch (state.intent) {
    case 'spreadsheet_cloud':
      return verifyCloudSheet(state, recent);
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
