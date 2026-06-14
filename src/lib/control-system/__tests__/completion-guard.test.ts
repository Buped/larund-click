import { describe, expect, it } from 'vitest';
import { preflight } from '../preflight';
import { createTaskState, applyCorrection } from '../../agent-state/task-state';
import { detectCorrection } from '../../agent-state/correction-detector';
import { verifyBeforeComplete } from '../completion-guard';
import type { RecentAction } from '../../agent-state/types';

const ok = (action: string, output = ''): RecentAction => ({ action, success: true, output });

function stateFor(goal: string) {
  return createTaskState(goal, preflight(goal));
}

describe('completion guard — cloud Google Sheet', () => {
  const goal = 'Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.';

  it('rejects completion when only a local sheet.write happened', () => {
    const s = stateFor(goal);
    const recent = [ok('browser.open'), ok('sheet.write', 'saved adatok.xlsx')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/local spreadsheet/i);
  });

  it('rejects completion when sheet opened but no data pasted', () => {
    const s = stateFor(goal);
    const recent = [ok('browser.open'), ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nTITLE: Untitled')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/still empty|never opened/i);
  });

  it('rejects completion at a login wall', () => {
    const s = stateFor(goal);
    const recent = [ok('browser.open'), ok('browser.read', 'URL: https://accounts.google.com/signin\nTITLE: Sign in\nSTATE_HINTS: login_required')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.nextStepHint).toMatch(/log in|ask_user/i);
  });

  it('accepts completion after paste + verified read-back', () => {
    const s = stateFor(goal);
    const recent = [
      ok('browser.open'),
      ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nINPUTS:\ngrid'),
      ok('clipboard.set'),
      ok('browser.paste', 'Pasted clipboard TSV'),
      ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nKovács János\nNagy Anna'),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(true);
  });
});

describe('completion guard — local spreadsheet', () => {
  it('accepts after write + read-back', () => {
    const s = stateFor('Készíts egy Excel fájlt 5 sor adattal.');
    const recent = [ok('sheet.write', 'saved adatok.xlsx'), ok('sheet.read', 'rows...')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });
  it('rejects without read-back', () => {
    const s = stateFor('Készíts egy Excel fájlt 5 sor adattal.');
    expect(verifyBeforeComplete(s, [ok('sheet.write')]).ok).toBe(false);
  });
});

describe('completion guard — file ops', () => {
  const goal = 'Create a folder on my desktop and move every txt file to it.';
  it('accepts after move + file.list verification', () => {
    const s = stateFor(goal);
    const recent = [ok('file.list'), ok('file.mkdir'), ok('file.move'), ok('file.list', 'a.txt\nb.txt')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });
  it('rejects when the final state was not verified after the move', () => {
    const s = stateFor(goal);
    const recent = [ok('file.mkdir'), ok('file.move')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(false);
  });
});

describe('completion guard — browser open-only', () => {
  it('accepts a YouTube open after read-back', () => {
    const s = stateFor('Nyisd meg a YouTube-ot.');
    const recent = [ok('browser.open'), ok('browser.read', 'URL: https://www.youtube.com\nTITLE: YouTube')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });
});

describe('completion guard — after a correction', () => {
  it('rejects an immediate re-complete with no fresh work', () => {
    const goal = 'Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.';
    const s = stateFor(goal);
    const c = detectCorrection('Nem, üres, nem töltötted fel.');
    applyCorrection(s, 'Nem, üres, nem töltötted fel.', c.interpretation, c.signals);
    const r = verifyBeforeComplete(s, [{ action: 'task.complete', success: true }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/corrected/i);
  });
});
