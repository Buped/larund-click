// Built-in workflow templates. Each maps onto existing no-mouse skills/tools.

import type { WorkflowTemplate } from './types';

function step(id: string, title: string, instruction: string, tools?: string[]) {
  return { id, title, instruction, preferredTools: tools };
}

export const BUILT_IN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'weekly-marketing-report',
    name: 'Weekly marketing report',
    description: 'Gather metrics from sheets/web and write a summary report.',
    source: 'builtin',
    triggerPhrases: ['weekly marketing report', 'marketing summary'],
    requiredSkills: ['marketing-report'],
    requiredConnections: [],
    steps: [
      step('s1', 'Gather inputs', 'Read the relevant sheets and any linked web sources.', ['sheet.read', 'browser.read']),
      step('s2', 'Aggregate metrics', 'Compute key metrics and week-over-week deltas.'),
      step('s3', 'Write report', 'Write the report as Markdown.', ['file.write']),
    ],
    verification: ['Report file exists and was read back', 'Key metrics present'],
    scheduleCapable: true,
    eventTriggerCapable: false,
  },
  {
    id: 'github-bugfix',
    name: 'GitHub bugfix workflow',
    description: 'Reproduce, fix, test and open a PR for a bug.',
    source: 'builtin',
    triggerPhrases: ['fix bug', 'bugfix', 'open a pr'],
    requiredSkills: ['vscode-project', 'github-maintainer'],
    requiredConnections: ['github'],
    steps: [
      step('s1', 'Locate', 'Find the relevant code with file.search/tree.', ['file.search', 'file.tree']),
      step('s2', 'Fix', 'Make a focused edit.', ['file.edit', 'file.write']),
      step('s3', 'Test', 'Run the tests/build.', ['cli.run']),
      step('s4', 'Summarize diff', 'Show the git diff and summarize it.', ['cli.run']),
    ],
    verification: ['Tests pass', 'Git diff summarized'],
    scheduleCapable: false,
    eventTriggerCapable: true,
  },
  {
    id: 'document-to-spreadsheet',
    name: 'Document to spreadsheet',
    description: 'Extract structured data from documents into a sheet.',
    source: 'builtin',
    triggerPhrases: ['document to spreadsheet', 'extract to sheet'],
    requiredSkills: ['document-accounting', 'local-office'],
    requiredConnections: [],
    steps: [
      step('s1', 'Read documents', 'Read referenced documents.', ['document.read', 'folder.scan']),
      step('s2', 'Extract fields', 'Extract the structured fields.'),
      step('s3', 'Write sheet', 'Write rows to a sheet and read them back.', ['sheet.write', 'sheet.read']),
    ],
    verification: ['Sheet rows match extracted data'],
    scheduleCapable: false,
    eventTriggerCapable: false,
  },
  {
    id: 'meeting-prep',
    name: 'Meeting prep',
    description: 'Compile context and an agenda for an upcoming meeting.',
    source: 'builtin',
    triggerPhrases: ['meeting prep', 'prepare for meeting'],
    requiredSkills: ['google-docs'],
    requiredConnections: ['google-workspace'],
    steps: [
      step('s1', 'Collect context', 'Read relevant docs/notes.', ['document.read', 'connection.call']),
      step('s2', 'Draft agenda', 'Write an agenda document.', ['doc.write_txt', 'connection.call']),
    ],
    verification: ['Agenda document created and read back'],
    scheduleCapable: true,
    eventTriggerCapable: false,
  },
  {
    id: 'competitor-research',
    name: 'Competitor research',
    description: 'Research competitors and summarize with sources.',
    source: 'builtin',
    triggerPhrases: ['competitor research', 'research competitors'],
    requiredSkills: ['browser-automation'],
    requiredConnections: [],
    steps: [
      step('s1', 'Identify', 'Identify the competitors.'),
      step('s2', 'Gather', 'Open and read each source.', ['browser.open', 'browser.read', 'browser.extract_table']),
      step('s3', 'Summarize', 'Write a sourced summary.', ['file.write']),
    ],
    verification: ['Summary cites real sources'],
    scheduleCapable: true,
    eventTriggerCapable: false,
  },
  {
    id: 'file-organization',
    name: 'File organization',
    description: 'Inventory and reorganize a folder with approval for bulk moves.',
    source: 'builtin',
    triggerPhrases: ['organize files', 'clean up folder'],
    requiredSkills: ['file-organizer'],
    requiredConnections: [],
    steps: [
      step('s1', 'Inspect', 'Inventory the folder.', ['file.tree', 'file.list']),
      step('s2', 'Plan', 'Propose a categorization plan.'),
      step('s3', 'Execute', 'Create folders and move files (approval for bulk).', ['file.mkdir', 'file.move']),
    ],
    verification: ['Final folder listing verified'],
    scheduleCapable: false,
    eventTriggerCapable: false,
  },
  {
    id: 'google-sheet-create-verify',
    name: 'Google Sheet creation and verification',
    description: 'Create a cloud Google Sheet, fill it, and verify by reading values back.',
    source: 'builtin',
    triggerPhrases: ['create google sheet', 'google táblázat'],
    requiredSkills: ['google-sheets', 'google-sheets-web'],
    requiredConnections: [],
    steps: [
      step('s1', 'Create/open', 'Create the cloud sheet (connection) or open sheets.new (browser).', ['connection.call', 'browser.open']),
      step('s2', 'Fill', 'Write the values.', ['connection.call', 'browser.paste']),
      step('s3', 'Verify', 'Read the values back / assert cells.', ['connection.call', 'browser.assert_text']),
    ],
    verification: ['Cloud sheet contains the expected rows (not a local file)'],
    scheduleCapable: false,
    eventTriggerCapable: false,
  },
  {
    id: 'landing-page-audit',
    name: 'Landing page audit',
    description: 'Audit a landing page and write findings.',
    source: 'builtin',
    triggerPhrases: ['landing page audit', 'audit page'],
    requiredSkills: ['browser-automation', 'marketing-report'],
    requiredConnections: [],
    steps: [
      step('s1', 'Open', 'Open the page and read content/structure.', ['browser.open', 'browser.read']),
      step('s2', 'Evaluate', 'Check headline, CTA, clarity, load signals.'),
      step('s3', 'Report', 'Write the audit findings.', ['file.write']),
    ],
    verification: ['Audit report written and read back'],
    scheduleCapable: true,
    eventTriggerCapable: false,
  },
];

export function getBuiltInTemplate(id: string): WorkflowTemplate | undefined {
  return BUILT_IN_WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
