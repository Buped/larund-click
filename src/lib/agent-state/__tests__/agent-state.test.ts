import { beforeEach, describe, expect, it } from 'vitest';
import { detectCorrection } from '../correction-detector';
import { preflight } from '../../control-system/preflight';
import { createTaskState, applyCorrection, renderTaskStatePrompt } from '../task-state';
import { resolveActiveTask, clearActiveTask, getActiveTask } from '../session-memory';

describe('correction-detector', () => {
  it('flags Hungarian corrections', () => {
    const r = detectCorrection('Nem. A Google táblázat üres. Nem töltötted fel. Töltsd fel a megnyitott google táblázatot!');
    expect(r.isCorrection).toBe(true);
    expect(r.signals).toContain('negation');
    expect(r.signals).toContain('empty');
    expect(r.signals).toContain('not_uploaded');
    expect(r.signals).toContain('use_open_target');
  });

  it('does not flag a fresh request', () => {
    const r = detectCorrection('Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.');
    expect(r.isCorrection).toBe(false);
  });
});

describe('preflight classification', () => {
  it('classifies a Google Sheet task as spreadsheet_cloud and forbids local sheet.write', () => {
    const pf = preflight('Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.');
    expect(pf.intent).toBe('spreadsheet_cloud');
    expect(pf.targetSurface).toBe('browser');
    expect(pf.forbiddenTools).toContain('sheet.write');
  });

  it('classifies an Excel task as spreadsheet_local', () => {
    const pf = preflight('Készíts egy Excel fájlt 5 sor adattal.');
    expect(pf.intent).toBe('spreadsheet_local');
    expect(pf.targetSurface).toBe('local_files');
  });

  it('classifies a YouTube open as a non-mutating browser task', () => {
    const pf = preflight('Nyisd meg a YouTube-ot.');
    expect(pf.intent).toBe('browser_webapp');
    expect(pf.mutates).toBe(false);
  });

  it('classifies a folder/move task as file_ops', () => {
    const pf = preflight('Create a folder on my desktop and move every txt file from my desktop to in that folder!');
    expect(pf.intent).toBe('file_ops');
    expect(pf.targetSurface).toBe('local_files');
  });
});

describe('task-state corrections', () => {
  it('folds a correction in without resetting, forbidding local-only strategy', () => {
    const pf = preflight('Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.');
    const state = createTaskState('Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.', pf);
    const before = state.id;
    const c = detectCorrection('Nem. A Google táblázat üres. Nem töltötted fel.');
    applyCorrection(state, 'Nem. A Google táblázat üres. Nem töltötted fel.', c.interpretation, c.signals);
    expect(state.id).toBe(before); // same task, not a new one
    expect(state.userCorrections.length).toBe(1);
    expect(state.failedAttempts.length).toBeGreaterThan(0);
    expect(state.forbiddenStrategies.join(' ')).toMatch(/local/i);
    expect(renderTaskStatePrompt(state)).toMatch(/User correction/);
  });
});

describe('session-memory', () => {
  beforeEach(() => clearActiveTask('s1'));

  it('continues the previous task on a correction (no reset)', () => {
    const first = resolveActiveTask('s1', 'Készíts egy új Google táblázatot és töltsd fel minimum 5 adattal.');
    expect(first.isCorrection).toBe(false);
    const firstId = first.state.id;

    const second = resolveActiveTask('s1', 'Nem. A Google táblázat üres. Nem töltötted fel.');
    expect(second.isCorrection).toBe(true);
    expect(second.state.id).toBe(firstId);
    expect(getActiveTask('s1')?.targetDocument?.type).toBe('google_sheet');
  });

  it('starts a new task for an unrelated fresh message', () => {
    const a = resolveActiveTask('s1', 'Nyisd meg a YouTube-ot.');
    const b = resolveActiveTask('s1', 'Készíts egy Excel fájlt 5 sor adattal.');
    expect(b.state.id).not.toBe(a.state.id);
    expect(b.state.intent).toBe('spreadsheet_local');
  });
});
