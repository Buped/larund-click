import { describe, expect, it } from 'vitest';
import { preflight } from '../preflight';
import { createTaskState, applyCorrection } from '../../agent-state/task-state';
import { detectCorrection } from '../../agent-state/correction-detector';
import { verifyBeforeComplete } from '../completion-guard';
import type { RecentAction } from '../../agent-state/types';

const ok = (action: string, output = ''): RecentAction => ({ action, success: true, output });
const conn = (tool: string, output = ''): RecentAction => ({ action: 'connection.call', success: true, output, argsSummary: tool });

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

  it('rejects paste plus generic browser.read without concrete cell proof', () => {
    const s = stateFor(goal);
    s.expectedData = { values: ['Kovacs Janos', 'Nagy Anna'] };
    const recent = [
      ok('browser.open'),
      ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nINPUTS:\ngrid'),
      ok('clipboard.set'),
      ok('browser.paste', 'Pasted clipboard TSV'),
      ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nKovács János\nNagy Anna'),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reliable cell-content proof|concrete/i);
  });

  it('accepts browser paste only after concrete expected values are asserted', () => {
    const s = stateFor(goal);
    s.expectedData = { values: ['Kovacs Janos', 'Nagy Anna', '50000'] };
    const recent = [
      ok('browser.open'),
      ok('browser.read', 'URL: https://docs.google.com/spreadsheets\nINPUTS:\ngrid'),
      ok('clipboard.set'),
      ok('browser.paste', 'Pasted clipboard TSV'),
      ok('browser.assert_text', 'assert_text ok: Kovacs Janos Nagy Anna 50000'),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(true);
  });

  it('accepts Google connection write followed by matching read_values', () => {
    const s = stateFor(goal);
    s.expectedData = { rows: [['Nev', 'Osszeg'], ['Kovacs Janos', '50000'], ['Nagy Anna', '42000']] };
    const recent = [
      conn('google.sheets.write_values'),
      conn('google.sheets.read_values', JSON.stringify({ values: [['Nev', 'Osszeg'], ['Kovacs Janos', '50000'], ['Nagy Anna', '42000']], rowCount: 3 })),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(true);
  });

  it('rejects Google connection write without read_values', () => {
    const s = stateFor(goal);
    const r = verifyBeforeComplete(s, [conn('google.sheets.write_values')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not read back/i);
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

describe('completion guard — Google Docs', () => {
  it('rejects Google Doc create/insert without read-back or export proof', () => {
    const s = stateFor('Készíts két példa számlát Google Docsban.');
    s.expectedData = { values: ['Szamla 001', 'Larund Kft'] };
    const r = verifyBeforeComplete(s, [
      conn('google.docs.create'),
      conn('google.docs.insert_text'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not read back|export/i);
  });

  it('accepts Google Doc after read-back contains expected content', () => {
    const s = stateFor('Készíts két példa számlát Google Docsban.');
    s.expectedData = { values: ['Szamla 001', 'Larund Kft'] };
    const r = verifyBeforeComplete(s, [
      conn('google.docs.create'),
      conn('google.docs.insert_text'),
      conn('google.docs.read', 'Szamla 001\nKibocsato: Larund Kft\nVegosszeg: 50000 Ft'),
    ]);
    expect(r.ok).toBe(true);
  });

  it('accepts Google Doc export only when the exported file is confirmed locally', () => {
    const s = stateFor('Készíts Google Docs számlát és exportáld docx-be.');
    const r = verifyBeforeComplete(s, [
      conn('google.docs.create'),
      conn('google.docs.insert_text'),
      conn('google.docs.export_docx', 'Exported Google Doc as DOCX'),
      ok('file.exists', 'true'),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('completion guard — local document', () => {
  it('rejects local docx write without read-back', () => {
    const s = stateFor('Készíts egy helyi docx dokumentumot.');
    const r = verifyBeforeComplete(s, [ok('doc.write_docx', 'Wrote invoice.docx')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not confirmed/i);
  });

  it('accepts local docx after document.read proof', () => {
    const s = stateFor('Készíts egy helyi docx dokumentumot.');
    s.expectedData = { values: ['Szamla 001', 'Larund Kft'] };
    const r = verifyBeforeComplete(s, [
      ok('doc.write_docx', 'Wrote invoice.docx'),
      ok('document.read', 'OK invoice.docx: Szamla 001 Larund Kft 50000 Ft'),
    ]);
    expect(r.ok).toBe(true);
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
describe('completion guard - active skills', () => {
  it('rejects completion when a skill is loaded but no work ran', () => {
    const s = stateFor('Irj egy helyi dokumentumot.');
    s.activeSkills = [{
      skillId: 'bundled:docx-writer',
      name: 'docx-writer',
      version: '1.0.0',
      body: 'Body',
      allowedTools: ['doc.write_docx', 'document.read'],
      requiredConnections: [],
      requiredMcpServers: [],
      risk: 'local_write',
      verificationChecklist: [{ id: 'v1', title: 'Read back output', required: true }],
      references: [],
      templates: [],
      missingRequirements: [],
    }];
    const r = verifyBeforeComplete(s, [ok('skill.run', 'loaded')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/skill was loaded/i);
  });

  it('rejects active skill completion without read-back evidence', () => {
    const s = stateFor('Irj egy helyi dokumentumot.');
    s.activeSkills = [{
      skillId: 'bundled:docx-writer',
      name: 'docx-writer',
      version: '1.0.0',
      body: 'Body',
      allowedTools: ['doc.write_docx', 'document.read'],
      requiredConnections: [],
      requiredMcpServers: [],
      risk: 'local_write',
      verificationChecklist: [{ id: 'v1', title: 'Read back output', required: true }],
      references: [],
      templates: [],
      missingRequirements: [],
    }];
    const r = verifyBeforeComplete(s, [ok('skill.run'), ok('doc.write_docx', 'Wrote test.docx')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/read-back/i);
  });
});
