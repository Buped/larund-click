// Derives the *goal state* of a task — the concrete artifacts that must exist for
// the task to count as done — from the pre-flight classification. The completion
// guard checks reality against this, instead of trusting the model's say-so.

import type { TaskPreflight } from '../control-system/preflight';
import type { ExpectedArtifact, SuccessCriterion, TargetDocument } from './types';

export function deriveTargetDocument(pf: TaskPreflight): TargetDocument | undefined {
  if (pf.targetDocumentType === 'google_sheet') {
    return { type: 'google_sheet', url: pf.targetUrl };
  }
  if (pf.targetDocumentType === 'local_sheet') {
    return { type: 'local_sheet' };
  }
  if (pf.targetDocumentType === 'google_doc') {
    return { type: 'google_doc', url: pf.targetUrl };
  }
  if (pf.targetDocumentType === 'local_doc') {
    return { type: 'local_doc' };
  }
  return undefined;
}

export function deriveExpectedArtifacts(pf: TaskPreflight): ExpectedArtifact[] {
  switch (pf.intent) {
    case 'spreadsheet_cloud':
      return [{ type: 'table', url: pf.targetUrl, description: 'Online Google Sheet populated with the requested rows' }];
    case 'spreadsheet_local':
      return [{ type: 'file', description: 'Local .xlsx/.csv file with the requested rows' }];
    case 'document_cloud':
      return [{ type: 'connection_record', url: pf.targetUrl, description: 'Cloud Google Doc with requested content' }];
    case 'document_local':
      return [{ type: 'file', description: 'Local document file with requested content' }];
    case 'browser_webapp':
      return [{ type: 'browser_page', url: pf.targetUrl, description: pf.expectedOutcome }];
    case 'file_ops':
      return [{ type: 'file', description: 'Files/folders in the requested final state' }];
    case 'connection_workflow':
      return [{ type: 'connection_record', description: pf.expectedOutcome }];
    case 'email':
      return [{ type: 'connection_record', description: pf.expectedOutcome }];
    default:
      return [{ type: 'text', description: pf.expectedOutcome }];
  }
}

/** True for surfaces where a rendered screenshot is the most reliable proof. */
export function isVisualIntent(intent: string | undefined): boolean {
  return intent === 'browser_webapp';
}

/**
 * Explicit, checkable acceptance conditions ("definition of done"). Visual
 * surfaces (browser/desktop apps) get a `visual` criterion so the screenshot
 * judge has a concrete target; everything else stays `structured` (read-back).
 */
export function deriveSuccessCriteria(pf: TaskPreflight): SuccessCriterion[] {
  const make = (text: string, method: SuccessCriterion['method']): SuccessCriterion => ({
    id: `crit-${Math.random().toString(36).slice(2, 8)}`,
    text,
    method,
    status: 'pending',
  });
  const checks = derivePendingChecks(pf).map((text) => make(text, 'structured'));
  if (isVisualIntent(pf.intent)) {
    checks.push(
      make(
        pf.mutates
          ? `The requested change is visibly reflected on the page/app screen: ${pf.expectedOutcome}`
          : `The requested page/app is visibly open and shows: ${pf.expectedOutcome}`,
        'visual',
      ),
    );
    checks.push(make('No login wall, CAPTCHA, permission prompt or error dialog is visible', 'visual'));
  }
  return checks;
}

/** Default verification checklist the loop seeds and the guard ticks off. */
export function derivePendingChecks(pf: TaskPreflight): string[] {
  switch (pf.intent) {
    case 'spreadsheet_cloud':
      return [
        'Sheet is open and not on a login page',
        'Data was written into the grid (paste/type/connection)',
        'Read-back confirms rows are present in the online sheet',
      ];
    case 'spreadsheet_local':
      return ['File written', 'File read back and rows confirmed'];
    case 'document_cloud':
      return ['Google Doc created/updated', 'google.docs.read confirms content', 'Export/read-back confirmed if requested'];
    case 'document_local':
      return ['Document file written', 'document.read/doc.read confirms content'];
    case 'browser_webapp':
      return pf.mutates
        ? ['Page open and verified', 'Change applied', 'Read-back confirms the change']
        : ['Page open and URL/title verified'];
    case 'file_ops':
      return ['Mutating operations succeeded', 'file.list/exists confirms final state'];
    case 'email':
      return pf.expectedOutcome.includes('SENT')
        ? ['Email composed from real source content', 'Approval obtained before sending', 'google.gmail.send confirmed the message in SENT']
        : ['Email composed from real source content', 'google.gmail.create_draft created a draft', 'Draft read-back confirmed the draft id'];
    default:
      return ['Action performed', 'Result verified by read-back'];
  }
}
