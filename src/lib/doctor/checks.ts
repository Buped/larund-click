// Pure Doctor checks. Each takes a DoctorFacts snapshot and returns a DoctorCheck.
// No I/O here — that keeps them deterministic and unit-testable. The live runner
// (run.ts) gathers facts and assembles the report.

import { isLegacyVisualActionName } from '../control-system/parser';
import type { CheckStatus, DoctorCheck, DoctorFacts, DoctorReport } from './types';

const REQUIRED_TOOLS = [
  'cli.run',
  'file.read',
  'file.write',
  'file.list',
  'document.read',
  'sheet.read',
  'sheet.write',
  'task.complete',
];

function check(id: string, label: string, status: CheckStatus, detail: string, remedy?: string): DoctorCheck {
  return { id, label, status, detail, remedy };
}

export function checkNoMouseCore(facts: DoctorFacts): DoctorCheck {
  const present = REQUIRED_TOOLS.filter((t) => facts.toolNames.includes(t));
  const missing = REQUIRED_TOOLS.filter((t) => !facts.toolNames.includes(t));
  if (missing.length === 0) {
    return check('no-mouse-core', 'No-mouse core tools registered', 'pass', `${present.length}/${REQUIRED_TOOLS.length} required tools present.`);
  }
  return check(
    'no-mouse-core',
    'No-mouse core tools registered',
    'fail',
    `Missing: ${missing.join(', ')}`,
    'The core tool catalog is incomplete — verify tools/registry.ts.',
  );
}

export function checkNoLegacyMouseTools(facts: DoctorFacts): DoctorCheck {
  const offenders = facts.toolNames.filter((t) => isLegacyVisualActionName(t));
  if (offenders.length === 0) {
    return check('no-legacy-mouse', 'No legacy mouse/visual actions exposed', 'pass', 'Tool catalog is free of mouse/cursor/visual actions.');
  }
  return check(
    'no-legacy-mouse',
    'No legacy mouse/visual actions exposed',
    'fail',
    `Forbidden actions present: ${offenders.join(', ')}`,
    'Remove the mouse/cursor/visual tools — Larund is a no-mouse operator.',
  );
}

export function checkDocumentExtract(facts: DoctorFacts): DoctorCheck {
  const ok = facts.toolNames.includes('document.read') && facts.toolNames.includes('document.summarize');
  return ok
    ? check('document-extract', 'Document text extraction available', 'pass', 'document.read / document.summarize present.')
    : check('document-extract', 'Document text extraction available', 'warn', 'document extraction tools not all present.', 'Ensure the document-reader tools are registered.');
}

export function checkSheetIo(facts: DoctorFacts): DoctorCheck {
  const ok = facts.toolNames.includes('sheet.read') && facts.toolNames.includes('sheet.write');
  return ok
    ? check('sheet-io', 'Spreadsheet read/write available', 'pass', 'sheet.read / sheet.write present.')
    : check('sheet-io', 'Spreadsheet read/write available', 'fail', 'sheet I/O tools missing.', 'Register the Rust-native sheet tools.');
}

export function checkBrowser(facts: DoctorFacts): DoctorCheck {
  if (facts.browserCdpAvailable === true) return check('browser-cdp', 'Browser (CDP) control', 'pass', 'CDP browser control is available.');
  if (facts.browserCdpAvailable === false) {
    return check('browser-cdp', 'Browser (CDP) control', 'warn', 'CDP browser is not currently available.', 'Start Chrome with the Larund debugging profile to enable browser tasks.');
  }
  return check('browser-cdp', 'Browser (CDP) control', 'warn', 'Browser availability unknown (not probed).');
}

export function checkGoogleWorkspace(facts: DoctorFacts): DoctorCheck {
  switch (facts.googleWorkspaceStatus) {
    case 'configured':
      return check('google-workspace', 'Google Workspace connection', 'pass', 'Google Workspace is configured.');
    case 'missing_auth':
      return check('google-workspace', 'Google Workspace connection', 'warn', 'Google Workspace is not authenticated.', 'Add a Google access token in Connections to enable Sheets/Docs/Drive.');
    default:
      return check('google-workspace', 'Google Workspace connection', 'warn', 'Google Workspace status unknown.', 'Open the Connections page to configure Google Workspace.');
  }
}

export function checkSkills(facts: DoctorFacts): DoctorCheck {
  if (facts.skillLoadErrors.length > 0) {
    return check('skills', 'Skills load', 'fail', `${facts.skillLoadErrors.length} skill(s) failed to load: ${facts.skillLoadErrors.join('; ')}`, 'Fix the skill frontmatter.');
  }
  if (facts.bundledSkillCount === 0) {
    return check('skills', 'Skills load', 'fail', 'No skills loaded.', 'Verify bundled skills.');
  }
  return check('skills', 'Skills load', 'pass', `${facts.bundledSkillCount} skills loaded cleanly.`);
}

export function checkStore(id: string, label: string, ok: boolean): DoctorCheck {
  return ok
    ? check(id, label, 'pass', 'Store read/write succeeded.')
    : check(id, label, 'fail', 'Store is not working.', 'Check the coworker persistence backend / database init.');
}

/** Assemble a full report from facts (pure). */
export function buildReport(facts: DoctorFacts, ranAt = new Date().toISOString()): DoctorReport {
  const checks: DoctorCheck[] = [
    checkNoMouseCore(facts),
    checkNoLegacyMouseTools(facts),
    checkDocumentExtract(facts),
    checkSheetIo(facts),
    checkBrowser(facts),
    checkGoogleWorkspace(facts),
    checkSkills(facts),
    checkStore('workspace-store', 'Workspace store', facts.workspaceStoreOk),
    checkStore('memory-store', 'Memory store', facts.memoryStoreOk),
    checkStore('task-store', 'Task/evidence store', facts.taskStoreOk),
  ];
  const summary = checks.reduce(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 },
  );
  return { ranAt, checks, summary };
}
