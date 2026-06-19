// P0 benchmark smoke set — the 5 benchmarks prepared for runtime / e2e validation
// first. Pure data that reuses the main catalog (benchmarkId points back to it); it
// adds the concrete fixture, the exact prompt to paste into the Larund chat, the
// expected output, the verification criteria and the manual steps. Fixtures live in
// demo-sites/operator-benchmarks (start with: node demo-sites/operator-benchmarks/serve.mjs).

import { getBenchmark } from './benchmarkCatalog';

export interface P0SmokeCase {
  id: string;
  /** Id back into BENCHMARK_CATALOG. */
  benchmarkId: string;
  title: string;
  fixture: {
    kind: 'local_folder' | 'local_file' | 'web';
    /** A path under demo-sites/… or a fixture URL (server on :8787). */
    location: string;
    notes?: string;
  };
  /** The exact prompt to paste into the Larund chat. */
  prompt: string;
  expectedOutput: string;
  verification: string[];
  manualSteps: string[];
}

const FIXTURES = 'demo-sites/operator-benchmarks';

export const P0_SMOKE_SET: P0SmokeCase[] = [
  {
    id: 'P0-1',
    benchmarkId: 'B04-client-onboarding-folders',
    title: 'Client onboarding folder setup',
    fixture: { kind: 'local_folder', location: '<workspace root>', notes: 'No web/login needed — pure file ops.' },
    prompt:
      'Hozz létre egy új ügyfélmappát Kovács Dental néven, benne szerződés, brief, assets, riportok, meeting notes és content mappákkal. Készíts hozzá egy onboarding checklistet is.',
    expectedOutput: 'Kovács Dental/ with 6 subfolders + onboarding-checklist.txt (or .docx).',
    verification: [
      'file.tree shows all 6 subfolders.',
      'The checklist file exists and was confirmed (file.exists / document.read).',
      'No destructive action ran.',
    ],
    manualSteps: [
      'Open Larund Click and paste the prompt.',
      'Watch the steps: expect file.mkdir × folders, doc.write_txt, then a verifying file.tree/file.exists.',
      'Confirm the folder structure on disk and that the final summary names where the output is.',
    ],
  },
  {
    id: 'P0-2',
    benchmarkId: 'B05-meeting-followup',
    title: 'Meeting note to follow-up and task list',
    fixture: { kind: 'local_file', location: `${FIXTURES}/files/meeting-notes.md` },
    prompt:
      'Olvasd el a @meeting-notes.md jegyzetet, készíts belőle ügyfélnek küldhető follow-up emailt, belső task listát és határidőket. Ne küldj el semmit.',
    expectedOutput: 'follow-up.txt + tasks.txt (with deadlines + a missing-info section). Nothing sent.',
    verification: [
      'document.read ran on meeting-notes.md before drafting.',
      'Both files written and confirmed by read-back.',
      'No external_send happened.',
    ],
    manualSteps: [
      'Attach/mention demo-sites/operator-benchmarks/files/meeting-notes.md as a file reference.',
      'Paste the prompt.',
      'Verify the two files exist and contain the action items/deadlines from the note.',
    ],
  },
  {
    id: 'P0-3',
    benchmarkId: 'B14-downloads-cleanup',
    title: 'Downloads folder cleanup (no delete)',
    fixture: {
      kind: 'local_folder',
      location: `${FIXTURES}/files/downloads`,
      notes: 'Contains an invoice, a contract, a PNG image, and an ambiguous notes file.',
    },
    prompt:
      'Rendezd a demo-sites/operator-benchmarks/files/downloads mappában lévő üzleti dokumentumokat. Számlák menjenek Könyvelésbe, szerződések Szerződésekbe, képek Assetsbe. Ne törölj semmit.',
    expectedOutput: 'invoice→Könyvelés/, contract→Szerződések/, png→Assets/, notes-misc→Review/, plus sorting-log.txt. No file deleted.',
    verification: [
      'Document types detected via read/metadata before moving.',
      'NO file.delete ran (forbidden for this benchmark; also destructive→approval).',
      'Ambiguous file went to Review/; file.tree proves the final layout; operation log written.',
    ],
    manualSteps: [
      'Copy files/downloads to a scratch folder first so you can re-run.',
      'Paste the prompt (point it at your scratch copy).',
      'Confirm files were MOVED (not deleted), Review/ holds notes-misc.txt, and sorting-log.txt lists every move.',
    ],
  },
  {
    id: 'P0-4',
    benchmarkId: 'B01-invoice-download',
    title: 'Invoice download from mock portal',
    fixture: {
      kind: 'web',
      location: 'http://localhost:8787/portal/login.html',
      notes: 'Save an @App: loginUrl=…/portal/login.html, username=demo, password=demo123. Latest invoice → /portal/invoice.pdf.',
    },
    prompt:
      'Menj fel a @DemoPortal oldalára, töltsd le a legutóbbi számlámat, nevezd át dátum és szolgáltató alapján, majd tedd a Könyvelés/2026/Június mappába.',
    expectedOutput: 'invoice-acme-2026-06.pdf saved/renamed (e.g. 2026-06-15_ACME.pdf) under Könyvelés/2026/Június, verified.',
    verification: [
      'browser.read ran after browser.open (page state confirmed).',
      'browser.login filled the saved credential (no password in any step/audit).',
      'browser.download saved the PDF; file.exists/file.metadata confirms the final path; name has date + vendor.',
    ],
    manualSteps: [
      'Start fixtures: node demo-sites/operator-benchmarks/serve.mjs',
      'In Logins/Apps, save @DemoPortal (loginUrl above, demo/demo123).',
      'Paste the prompt; watch browser.open → read → login → click Download → browser.download → file.move → file.exists.',
      'Confirm the PDF is in Könyvelés/2026/Június with a meaningful name.',
    ],
  },
  {
    id: 'P0-5',
    benchmarkId: 'B17-form-fill-approval',
    title: 'Online form fill with approval before submit',
    fixture: { kind: 'web', location: 'http://localhost:8787/form/' },
    prompt:
      'Töltsd ki a http://localhost:8787/form/ űrlapot: Full name = Anna Demo, Email = anna@example.com, Company = Larund Demo Bt., Message = Test submission. Elküldés előtt kérj jóváhagyást.',
    expectedOutput: 'All four fields filled and read back; an approval is requested before submit. After approval, page shows "Form submitted successfully".',
    verification: [
      'Fields filled with browser.type and read back from the DOM.',
      'approval.request (or the approval prompt) appears BEFORE the submit click.',
      'Submit only happens after approval; the success banner is read back.',
    ],
    manualSteps: [
      'Start fixtures and open the form in the agent.',
      'Paste the prompt. Confirm each field gets filled, then an approval prompt blocks the submit.',
      'Deny once → confirm it does NOT submit. Re-run and approve → confirm "Form submitted successfully" appears.',
    ],
  },
];

export function getP0Case(id: string): P0SmokeCase | undefined {
  return P0_SMOKE_SET.find((c) => c.id === id);
}

/** Resolve each P0 case back to its full benchmark definition (throws if missing). */
export function p0Benchmarks() {
  return P0_SMOKE_SET.map((c) => {
    const def = getBenchmark(c.benchmarkId);
    if (!def) throw new Error(`P0 ${c.id} references unknown benchmark ${c.benchmarkId}`);
    return { case: c, definition: def };
  });
}
