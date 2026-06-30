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

describe('completion guard - professional local Excel reports', () => {
  it('rejects report workbooks that only wrote a plain grid', () => {
    const s = stateFor('Keszits egy Excel tablazatot a boltok teljesitmenyerol, minimum 50 elemmel, meg minden ilyesmivel.');
    const r = verifyBeforeComplete(s, [ok('sheet.write', 'saved report.xlsx'), ok('sheet.read', 'rows...')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/professional Excel report/i);
    expect(r.nextStepHint).toMatch(/sheet\.format_range/);
    expect(r.nextStepHint).toMatch(/sheet\.add_table/);
    expect(r.nextStepHint).toMatch(/sheet\.add_chart/);
  });

  it('accepts report workbooks after styling table chart and read-back', () => {
    const s = stateFor('Keszits egy Excel tablazatot a boltok teljesitmenyerol, minimum 50 elemmel, meg minden ilyesmivel.');
    const recent = [
      ok('sheet.write', 'saved report.xlsx'),
      ok('sheet.format_range', 'formatted header and body'),
      ok('sheet.add_table', 'table_added'),
      ok('sheet.add_chart', 'chart_added'),
      ok('sheet.read', 'rows...'),
    ];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });
});

describe('completion guard — Gmail email/draft', () => {
  const sendGoal = 'Küldj egy emailt a ninjapeti2000@gmail.com email címre a csatolt Drive file alapján. Írj egy rövid összefoglalót.';
  const draftGoal = 'Írd meg ezt a draftot a ninjapeti2000@gmail.com címre a csatolt Drive file alapján.';

  it('classifies a send-an-email task as email, not browser_webapp', () => {
    expect(preflight(sendGoal).intent).toBe('email');
  });

  it('rejects a TXT-only "draft" as a Gmail draft', () => {
    const s = stateFor(draftGoal);
    const recent = [ok('document.read', 'Google Docs read via API: 4200 chars'), ok('doc.write_txt', 'wrote draft.txt')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/local txt|not a gmail draft/i);
  });

  it('rejects completion when no email composer card was surfaced', () => {
    const s = stateFor(draftGoal);
    const recent = [ok('document.read', 'Google Docs read via API: 4200 chars')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.nextStepHint).toMatch(/email\.compose/i);
  });

  it('accepts a verified Gmail draft (draft-only request)', () => {
    const s = stateFor(draftGoal);
    const recent = [
      ok('document.read', 'Google Docs read via API: 4200 chars'),
      conn('google.gmail.create_draft', 'Gmail piszkozat létrehozva (ninjapeti2000@gmail.com – "Összefoglaló"). Read-back: megerősítve.'),
    ];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });

  it('does NOT require a browser.open when the API read already succeeded', () => {
    const s = stateFor(draftGoal);
    const recent = [
      ok('document.read', 'Google Docs read via API'),
      conn('google.gmail.create_draft', 'Read-back: megerősítve.'),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(true);
  });

  it('rejects a draft when the user asked to SEND but no send is confirmed', () => {
    const s = stateFor(sendGoal);
    const recent = [conn('google.gmail.create_draft', 'Read-back: megerősítve.')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/send|SENT/i);
  });

  it('accepts a confirmed Gmail send', () => {
    const s = stateFor(sendGoal);
    const recent = [
      conn('google.gmail.create_draft', 'Read-back: megerősítve.'),
      conn('google.gmail.send', 'Email elküldve (ninjapeti2000@gmail.com). Read-back: a SENT mappában megerősítve.'),
    ];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });

  it('accepts a Gmail draft created via the email.compose card', () => {
    const s = stateFor(draftGoal);
    const recent: RecentAction[] = [
      ok('document.read', 'Google Docs read via API'),
      { action: 'email.compose', success: true, output: 'Gmail piszkozat létrehozva (ninjapeti2000@gmail.com – "Összefoglaló"). Read-back: megerősítve. [gmail_draft_created]' },
    ];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });

  it('accepts an email.compose LOCAL draft card (the card has a one-click Connect button)', () => {
    const s = stateFor(draftGoal);
    const recent: RecentAction[] = [
      ok('document.read', 'Google Docs read via API'),
      { action: 'email.compose', success: true, output: 'Email vázlat elkészült a chat composerben … [local_draft]' },
    ];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });

  it('still rejects a TXT file even when an email.compose card is absent', () => {
    const s = stateFor(draftGoal);
    const recent: RecentAction[] = [ok('document.read', 'read'), ok('doc.write_txt', 'wrote draft.txt')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(false);
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

describe('completion guard — mandatory visual check (browser/app)', () => {
  const MUTATION_OUTCOME = 'The web app reflects the requested change, confirmed by reading the page after acting. Opening the page alone is not enough.';
  const verdict = (o: Record<string, unknown>): RecentAction => ({ action: 'screen.verify', success: true, output: JSON.stringify({ done: false, progress: 0, metCriteria: [], unmetCriteria: [], blockers: [], ...o }) });

  function mutatingBrowserState() {
    const s = stateFor('Kattints a Mentés gombra a megnyitott weboldalon.');
    s.intent = 'browser_webapp';
    s.expectedOutcome = MUTATION_OUTCOME;
    return s;
  }

  it('rejects a mutating browser task with no visual confirmation', () => {
    const s = mutatingBrowserState();
    const recent = [ok('browser.open'), ok('browser.click'), ok('browser.read', 'URL: https://app.example\nrow added')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no screen\.verify visual confirmation/i);
  });

  it('rejects when the visual check did not confirm done', () => {
    const s = mutatingBrowserState();
    const recent = [ok('browser.open'), ok('browser.click'), ok('browser.read', 'row added'), verdict({ done: false, progress: 40, unmetCriteria: ['row not visible yet'] })];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not confirm completion/i);
  });

  it('rejects when the screen changed after the last visual check (stale)', () => {
    const s = mutatingBrowserState();
    const recent = [ok('browser.open'), verdict({ done: true, progress: 100 }), ok('browser.click')];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale/i);
  });

  it('rejects when the visual check reports a blocker', () => {
    const s = mutatingBrowserState();
    const recent = [ok('browser.open'), ok('browser.click'), ok('browser.read'), verdict({ done: false, blockers: ['login wall'] })];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/blocker/i);
  });

  it('accepts a mutating browser task confirmed by a done visual check after the change', () => {
    const s = mutatingBrowserState();
    const recent = [
      ok('browser.open'),
      ok('browser.click'),
      ok('browser.read', 'URL: https://app.example\nrow added'),
      verdict({ done: true, progress: 100, metCriteria: ['row visible'] }),
    ];
    const r = verifyBeforeComplete(s, recent);
    expect(r.ok).toBe(true);
  });

  it('does NOT require a visual check for open-only browser tasks', () => {
    const s = stateFor('Nyisd meg a YouTube-ot.');
    const recent = [ok('browser.open'), ok('browser.read', 'URL: https://www.youtube.com\nTITLE: YouTube')];
    expect(verifyBeforeComplete(s, recent).ok).toBe(true);
  });

  it('does NOT require a visual check for non-visual (local file) tasks', () => {
    const s = stateFor('Készíts egy Excel fájlt 5 sor adattal.');
    const recent = [ok('sheet.write', 'saved adatok.xlsx'), ok('sheet.read', 'rows...')];
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

describe('completion guard - scoped local spreadsheet enrichment', () => {
  function scopedState() {
    const s = stateFor('@company-names.ods Keresd ki az interneten a hianyzo adatokat. Irj bele a tablazatba.');
    s.intent = 'spreadsheet_local';
    s.expectedScope = {
      kind: 'spreadsheet_rows',
      sourcePath: 'C:/tmp/company-names.ods',
      headerRow: 1,
      dataRows: 25,
      requiredRows: Array.from({ length: 25 }, (_, i) => i + 2),
      requiredColumns: ['Ceg neve', 'Weboldal linkje', 'Forras URL', 'Bizonyossag'],
      allowPartial: false,
    };
    return s;
  }

  it('rejects a sibling xlsx instead of the original ods target', () => {
    const r = verifyBeforeComplete(scopedState(), [
      { action: 'sheet.write', success: true, argsSummary: '{"path":"C:/tmp/company-names.xlsx"}', output: 'saved company-names.xlsx' },
      { action: 'sheet.read', success: true, argsSummary: '{"path":"C:/tmp/company-names.xlsx"}', output: JSON.stringify({ path: 'C:/tmp/company-names.xlsx', rows: [['Ceg neve']], row_count: 6 }) },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/original spreadsheet target/i);
  });

  it('rejects missing source and confidence columns in read-back', () => {
    const rows = [['Ceg neve', 'Weboldal linkje'], ...Array.from({ length: 25 }, (_, i) => [`Company ${i + 1}`, 'https://example.com'])];
    const r = verifyBeforeComplete(scopedState(), [
      { action: 'sheet.update_cells', success: true, argsSummary: '{"path":"C:/tmp/company-names.ods"}', output: 'saved C:/tmp/company-names.ods' },
      { action: 'sheet.read', success: true, argsSummary: '{"path":"C:/tmp/company-names.ods"}', output: JSON.stringify({ path: 'C:/tmp/company-names.ods', rows, row_count: rows.length }) },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing required columns/i);
  });

  it('accepts original-target write after full row read-back coverage', () => {
    const rows = [
      ['Ceg neve', 'Weboldal linkje', 'Forras URL', 'Bizonyossag'],
      ...Array.from({ length: 25 }, (_, i) => [`Company ${i + 1}`, 'https://example.com', 'https://source.example', '0.82']),
    ];
    const r = verifyBeforeComplete(scopedState(), [
      { action: 'web.batch_search', success: true, output: '25 queries searched' },
      { action: 'sheet.update_cells', success: true, argsSummary: '{"path":"C:/tmp/company-names.ods"}', output: 'roundtrip_with_backup C:/tmp/company-names.ods' },
      { action: 'sheet.read', success: true, argsSummary: '{"path":"C:/tmp/company-names.ods"}', output: JSON.stringify({ path: 'C:/tmp/company-names.ods', rows, row_count: rows.length }) },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('completion guard - web lookup evidence', () => {
  it('rejects browser fallback for explicit internet search', () => {
    const s = stateFor('Keresd ki az interneten a legfrissebb hireket a SpaceX-el kapcsolatban!');
    const recent: RecentAction[] = [
      { action: 'web.search', success: false, error: 'web_search_unavailable' },
      { action: 'browser.open', success: true, argsSummary: '{"url":"https://www.anthropic.com/news"}', output: 'Opened' },
      { action: 'browser.read', success: true, output: 'URL: https://www.anthropic.com/news\nTITLE: News' },
    ];
    const result = verifyBeforeComplete(s, recent);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no provider-native or server-side web search evidence/i);
  });

  it('accepts server-side web.search with clickable sources', () => {
    const s = stateFor('Keresd ki az interneten a legfrissebb hireket a SpaceX-el kapcsolatban!');
    const output = JSON.stringify({
      query: 'SpaceX latest news',
      provider: 'brave',
      searchedAt: '2026-06-24T10:00:00.000Z',
      results: [{ title: 'SpaceX update', url: 'https://example.com/spacex', snippet: 'Latest news', rank: 1 }],
    });
    const result = verifyBeforeComplete(s, [{ action: 'web.search', success: true, argsSummary: '{"query":"SpaceX latest news"}', output }]);
    expect(result.ok).toBe(true);
  });
});

describe('completion guard - office result packs', () => {
  it('rejects system-to-system copy without source read/schema evidence', () => {
    const s = stateFor('Masold at a HubSpot kontaktokat Google Sheetsbe.');
    const r = verifyBeforeComplete(s, [
      conn('google.sheets.append_or_update_rows', 'Read-back: verified.'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/source read\/schema/i);
  });

  it('rejects system-to-system copy without target read-back', () => {
    const s = stateFor('Masold at a HubSpot kontaktokat Google Sheetsbe.');
    const r = verifyBeforeComplete(s, [
      conn('hubspot.search_contacts', JSON.stringify({ results: [{ id: '1' }] })),
      conn('google.sheets.append_or_update_rows', 'Appended 1 row'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not read target/i);
  });

  it('rejects HubSpot CRM writes without record read-back', () => {
    const s = stateFor('Frissitsd a HubSpot CRM rekordot a meeting alapjan.');
    const r = verifyBeforeComplete(s, [
      ok('document.read', 'Meeting notes'),
      conn('hubspot.update_contact', 'Contact updated'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/CRM write/i);
  });

  it('rejects meeting actions when notes were not read', () => {
    const s = stateFor('Meeting jegyzet alapjan keszits follow-up taskokat owner es hatarido mezokkel.');
    const r = verifyBeforeComplete(s, [
      ok('doc.write_txt', 'Action: Follow up. Owner: Peter. Due: tomorrow.'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/meeting notes/i);
  });
});
