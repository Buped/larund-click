// Pre-flight task classification.
//
// Before the loop runs, we classify the task once so the rest of the system can
// make surface-aware decisions: which tools to prefer, whether auth is likely,
// and — critically — what "done" means. A Google Sheets task and a local Excel
// task look similar in words but have completely different completion criteria.

import type { TaskSurface, TargetDocumentType } from '../agent-state/types';

export type TaskIntent =
  | 'file_ops'
  | 'browser_webapp'
  | 'local_app'
  | 'coding'
  | 'connection_workflow'
  | 'spreadsheet_local'
  | 'spreadsheet_cloud'
  | 'document_local'
  | 'document_cloud'
  | 'unsupported_gui';

export interface TaskPreflight {
  intent: TaskIntent;
  targetSurface: TaskSurface | 'cli' | 'files';
  targetApp?: string;
  targetUrl?: string;
  targetDocumentType?: TargetDocumentType;
  requiresAuth?: boolean;
  /** Whether the verb implies creating/modifying content (vs. just opening). */
  mutates: boolean;
  expectedOutcome: string;
  recommendedTools: string[];
  forbiddenTools: string[];
}

const URL_RE = /\bhttps?:\/\/[^\s'"]+/i;

// Verbs that mean "produce or change content" (so opening a page is not enough).
const MUTATE_RE =
  /\b(készíts|hozz létre|tölts? ?d? ?fel|tölts|írj|adj hozzá|módosíts|szerkeszt|rendezd|rendszerezd|mozgasd|másold|töröld|create|make|build|fill|populate|upload|write|add|edit|modify|move|organi[sz]e|rename|delete|register|sign ?up|post|submit|send)\b/i;

const OPEN_ONLY_RE =
  /\b(nyisd meg|nyiss|open|launch|indítsd|navigálj|go to|show me)\b/i;

function isGoogleSheet(t: string): boolean {
  return (
    /google\s*(táblá|sheet|spreadsheet)/i.test(t) ||
    /sheets\.new/i.test(t) ||
    /docs\.google\.com\/spreadsheets/i.test(t) ||
    /\bgoogle\s*táblázat/i.test(t) ||
    /(megnyitott|online)\s*(google\s*)?táblázat/i.test(t)
  );
}

function isGoogleDoc(t: string): boolean {
  return (
    /google\s*(docs?|document|doksi|dokumentum)/i.test(t) ||
    /docs\.new/i.test(t) ||
    /docs\.google\.com\/document/i.test(t)
  );
}

function isLocalSpreadsheet(t: string): boolean {
  return (
    /\bexcel\b/i.test(t) ||
    /\.(xlsx|xls|csv|ods)\b/i.test(t) ||
    /\b(lokális|helyi|local)\s+(táblá|spreadsheet|excel|csv)/i.test(t) ||
    /\bcsv\b/i.test(t)
  );
}

function isLocalDocument(t: string): boolean {
  return (
    /\.(docx|doc|txt|pdf)\b/i.test(t) ||
    /\b(word|docx|document|dokumentum|szoveg|szöveg|txt)\b/i.test(t) ||
    /\b(lokalis|lokális|helyi|local)\s+(word|document|dokumentum|docx|txt)/i.test(t)
  );
}

const FILE_OPS_RE =
  /\b(mappá|mappa|folder|könyvtár|fájl|fájlok|file|files|asztal|desktop|directory|\.txt|\.pdf|\.png|\.jpg|\.zip)\b/i;

const CODING_RE =
  /\b(kód|code|repo|repository|git\b|commit|függvény|function|bug|fordít|compile|build the|npm|cargo|tsc)\b/i;

const CONNECTION_HINTS: Array<{ re: RegExp; app: string }> = [
  { re: /\bgmail\b|\be-?mail(t|eket|ek)?\b|\binbox\b/i, app: 'gmail' },
  { re: /\bnotion\b/i, app: 'notion' },
  { re: /\bslack\b/i, app: 'slack' },
  { re: /\bgithub\b|\bpull request\b|\bissue\b/i, app: 'github' },
  { re: /\bcalendar\b|\bnaptár\b/i, app: 'calendar' },
];

const BROWSER_HINTS =
  /\b(youtube|google|böngész|browser|weboldal|website|web ?app|web ?form|űrlap|form|shopify|facebook|twitter|x\.com|gmail\.com|amazon|wikipedia)\b/i;

/** Classify a task once, up front. Pure and deterministic for testability. */
export function preflight(task: string): TaskPreflight {
  const t = task.toLowerCase();
  const url = task.match(URL_RE)?.[0];
  const mutates = MUTATE_RE.test(t) || (!OPEN_ONLY_RE.test(t) && /\bform\b|\bűrlap\b/i.test(t));

  // 1) Cloud Google Sheet wins over everything spreadsheet-shaped.
  if (isGoogleSheet(t)) {
    return {
      intent: 'spreadsheet_cloud',
      targetSurface: 'browser',
      targetUrl: url ?? 'https://sheets.new',
      targetDocumentType: 'google_sheet',
      requiresAuth: true,
      mutates: true,
      expectedOutcome:
        'A Google Sheet open in the browser contains the requested data (rows visible in the grid). A local file does NOT satisfy this.',
      recommendedTools: [
        'browser.open', 'browser.read', 'browser.wait', 'browser.paste',
        'browser.shortcut', 'clipboard.set', 'connection.call', 'ask_user',
      ],
      forbiddenTools: ['sheet.write'],
    };
  }

  // 1b) Cloud Google Docs is distinct from local DOCX/TXT.
  if (isGoogleDoc(t)) {
    return {
      intent: 'document_cloud',
      targetSurface: 'connection',
      targetUrl: url ?? 'https://docs.new',
      targetDocumentType: 'google_doc',
      requiresAuth: true,
      mutates: true,
      expectedOutcome:
        'A Google Doc exists in the cloud with the requested content, confirmed by google.docs.read or an exported file read-back.',
      recommendedTools: [
        'connection.call', 'ask_user', 'browser.open', 'browser.read',
      ],
      forbiddenTools: ['doc.write_txt', 'doc.write_docx'],
    };
  }

  // 2) Local spreadsheet (Excel/CSV) — only when no Google cloud signal.
  if (isLocalSpreadsheet(t)) {
    return {
      intent: 'spreadsheet_local',
      targetSurface: 'local_files',
      targetDocumentType: 'local_sheet',
      mutates: true,
      expectedOutcome:
        'A local spreadsheet file (.xlsx/.csv) exists with the requested rows, confirmed by reading it back.',
      recommendedTools: ['sheet.write', 'sheet.read', 'file.exists'],
      forbiddenTools: [],
    };
  }

  // 2b) Local Word/TXT/PDF-like document target.
  if (isLocalDocument(t) && !isGoogleDoc(t) && !/\b(mozgasd|move|rendezd|organise|organize|copy|delete|mapp|folder)\b/i.test(t)) {
    return {
      intent: 'document_local',
      targetSurface: 'local_files',
      targetDocumentType: 'local_doc',
      mutates,
      expectedOutcome:
        'A local document file exists with the requested content, confirmed by document/doc read-back.',
      recommendedTools: ['doc.write_docx', 'doc.write_txt', 'document.read', 'doc.read', 'file.exists'],
      forbiddenTools: [],
    };
  }

  // 3) Explicit URL or webapp keyword → browser.
  if (url || BROWSER_HINTS.test(t)) {
    return {
      intent: 'browser_webapp',
      targetSurface: 'browser',
      targetUrl: url,
      requiresAuth: /\b(login|bejelentkez|sign ?in|account|fiók|regisztrál|sign ?up)\b/i.test(t),
      mutates,
      expectedOutcome: mutates
        ? 'The web app reflects the requested change, confirmed by reading the page after acting. Opening the page alone is not enough.'
        : 'The requested page is open and confirmed by its URL/title.',
      recommendedTools: ['browser.open', 'browser.read', 'browser.wait', 'browser.click', 'browser.type', 'browser.assert_url'],
      forbiddenTools: [],
    };
  }

  // 4) Connection workflow (email/notion/slack/github/calendar).
  for (const { re, app } of CONNECTION_HINTS) {
    if (re.test(t)) {
      return {
        intent: 'connection_workflow',
        targetSurface: 'connection',
        targetApp: app,
        requiresAuth: true,
        mutates,
        expectedOutcome: `The ${app} action completed and was confirmed by a read-back or tool result.`,
        recommendedTools: ['connection.call', 'browser.open', 'browser.read', 'ask_user'],
        forbiddenTools: [],
      };
    }
  }

  // 5) File operations.
  if (FILE_OPS_RE.test(t)) {
    return {
      intent: 'file_ops',
      targetSurface: 'local_files',
      mutates,
      expectedOutcome:
        'The files/folders are in the requested final state, confirmed with file.list / file.exists / file.tree.',
      recommendedTools: ['file.list', 'file.mkdir', 'file.move', 'file.copy', 'file.exists', 'file.tree'],
      forbiddenTools: [],
    };
  }

  // 6) Coding / shell.
  if (CODING_RE.test(t)) {
    return {
      intent: 'coding',
      targetSurface: 'cli',
      mutates,
      expectedOutcome: 'The code change was made and verified (build/test/read-back succeeded).',
      recommendedTools: ['cli.run', 'file.read', 'file.write', 'file.edit', 'file.search'],
      forbiddenTools: [],
    };
  }

  // 7) Fallback — treat as a general task that still requires evidence, but
  //    without imposing surface-specific completion rules.
  return {
    intent: 'coding',
    targetSurface: 'cli',
    mutates,
    expectedOutcome: 'The requested outcome was achieved and verified by a tool result.',
    recommendedTools: ['cli.run', 'file.read', 'browser.read'],
    forbiddenTools: [],
  };
}
