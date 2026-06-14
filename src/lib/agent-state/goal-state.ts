// Derives the *goal state* of a task — the concrete artifacts that must exist for
// the task to count as done — from the pre-flight classification. The completion
// guard checks reality against this, instead of trusting the model's say-so.

import type { TaskPreflight } from '../control-system/preflight';
import type { ExpectedArtifact, TargetDocument } from './types';

export function deriveTargetDocument(pf: TaskPreflight): TargetDocument | undefined {
  if (pf.targetDocumentType === 'google_sheet') {
    return { type: 'google_sheet', url: pf.targetUrl };
  }
  if (pf.targetDocumentType === 'local_sheet') {
    return { type: 'local_sheet' };
  }
  return undefined;
}

export function deriveExpectedArtifacts(pf: TaskPreflight): ExpectedArtifact[] {
  switch (pf.intent) {
    case 'spreadsheet_cloud':
      return [{ type: 'table', url: pf.targetUrl, description: 'Online Google Sheet populated with the requested rows' }];
    case 'spreadsheet_local':
      return [{ type: 'file', description: 'Local .xlsx/.csv file with the requested rows' }];
    case 'browser_webapp':
      return [{ type: 'browser_page', url: pf.targetUrl, description: pf.expectedOutcome }];
    case 'file_ops':
      return [{ type: 'file', description: 'Files/folders in the requested final state' }];
    case 'connection_workflow':
      return [{ type: 'connection_record', description: pf.expectedOutcome }];
    default:
      return [{ type: 'text', description: pf.expectedOutcome }];
  }
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
    case 'browser_webapp':
      return pf.mutates
        ? ['Page open and verified', 'Change applied', 'Read-back confirms the change']
        : ['Page open and URL/title verified'];
    case 'file_ops':
      return ['Mutating operations succeeded', 'file.list/exists confirms final state'];
    default:
      return ['Action performed', 'Result verified by read-back'];
  }
}
