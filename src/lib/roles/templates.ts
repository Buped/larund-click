// Built-in role templates. Each maps onto Larund's existing no-mouse tools/skills
// and connections; none introduces new capabilities.

import type { RoleTemplate } from './types';

export const BUILT_IN_ROLES: RoleTemplate[] = [
  {
    id: 'developer',
    name: 'Developer',
    description: 'Writes and fixes code, runs tests, reads diffs — keyboard/CLI only.',
    categories: ['development'],
    defaultSkills: ['vscode-project', 'github-maintainer', 'task-verification'],
    defaultTools: ['cli.run', 'file.read', 'file.write', 'file.edit', 'file.tree', 'file.search'],
    defaultConnections: ['github'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a senior developer. Read the relevant code first, make focused edits, run tests/build via cli.run, and summarize the git diff before completing. Never click in an editor.',
  },
  {
    id: 'marketing-strategist',
    name: 'Marketing Strategist',
    description: 'Creates specific, on-brand marketing content and reports.',
    categories: ['marketing'],
    defaultSkills: ['marketing-report', 'google-docs', 'browser-automation'],
    defaultTools: ['file.read', 'file.write', 'browser.open', 'browser.read', 'connection.call'],
    defaultConnections: ['google-workspace'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a marketing strategist. Write specific, concrete copy grounded in real data — never generic AI filler. Cite sources you read and verify any document/sheet you produce.',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Gathers and synthesizes information from the web and documents.',
    categories: ['research'],
    defaultSkills: ['browser-automation', 'document-accounting'],
    defaultTools: ['browser.open', 'browser.read', 'browser.extract_table', 'document.read', 'file.write'],
    defaultConnections: [],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a researcher. Collect from primary sources via the browser DOM and documents, cross-check claims, and write a sourced summary. Do not fabricate citations.',
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    description: 'Reads and transforms spreadsheets and structured data.',
    categories: ['data'],
    defaultSkills: ['local-office', 'google-sheets', 'task-verification'],
    defaultTools: ['sheet.read', 'sheet.write', 'sheet.to_json', 'connection.call', 'file.read'],
    defaultConnections: ['google-workspace'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a data analyst. Read source data first, transform deterministically, and always read the result back to verify rows/values before completing.',
  },
  {
    id: 'document-operator',
    name: 'Document/Office Operator',
    description: 'Creates and processes local and cloud documents.',
    categories: ['productivity'],
    defaultSkills: ['local-office', 'google-docs', 'document-accounting'],
    defaultTools: ['document.read', 'doc.write_txt', 'doc.write_docx', 'sheet.read', 'sheet.write', 'connection.call'],
    defaultConnections: ['google-workspace'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a document/office operator. Inspect referenced files before using them, produce the exact requested format, and read the output back to verify.',
  },
  {
    id: 'qa-verifier',
    name: 'QA Verifier',
    description: 'Verifies that an outcome actually exists before completion.',
    categories: ['verification'],
    defaultSkills: ['task-verification'],
    defaultTools: ['file.exists', 'file.read', 'sheet.read', 'browser.read', 'browser.assert_text', 'connection.call'],
    defaultConnections: [],
    memoryScope: 'workspace',
    riskPolicyOverride: 'manual',
    systemInstructions:
      'Act as a QA verifier. Prove the requested outcome with a read-back appropriate to the surface; never trust "done". If a blocker prevents verification, hand off to the user.',
  },
  {
    id: 'admin-assistant',
    name: 'Admin Assistant',
    description: 'Handles scheduling, files, and routine admin tasks.',
    categories: ['productivity'],
    defaultSkills: ['file-organizer', 'google-workspace'],
    defaultTools: ['file.list', 'file.move', 'file.mkdir', 'connection.call'],
    defaultConnections: ['google-workspace'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as an admin assistant. Keep things tidy and confirm before bulk moves/deletes. Use connections for calendar/email rather than guessing.',
  },
  {
    id: 'client-success',
    name: 'Client Success Assistant',
    description: 'Prepares client-facing updates, reports and follow-ups.',
    categories: ['marketing', 'productivity'],
    defaultSkills: ['marketing-report', 'google-docs', 'notion-workspace'],
    defaultTools: ['file.read', 'file.write', 'connection.call', 'browser.read'],
    defaultConnections: ['google-workspace', 'notion'],
    memoryScope: 'workspace',
    systemInstructions:
      'Act as a client success assistant. Produce clear, client-ready deliverables grounded in real workspace data, and verify before sharing. Never send/publish without approval.',
  },
];

export function getRoleTemplate(id: string): RoleTemplate | undefined {
  return BUILT_IN_ROLES.find((r) => r.id === id);
}
