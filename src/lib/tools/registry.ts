import type { ControlActionName } from '../control-system/types';
import type { ToolCategory, ToolRisk } from './types';
import { ACTION_CATEGORY } from './policy';

export interface ToolCatalogEntry {
  name: ControlActionName;
  category: ToolCategory;
  baseRisk: ToolRisk;
  description: string;
}

// A descriptive catalog of every action, used for the UI tool list and for the
// prompt's tool-catalog summary. Actual risk for a call is computed dynamically
// in policy.assessRisk (some depend on args); baseRisk is the typical case.
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: 'cli.run', category: 'runtime', baseRisk: 'process_exec', description: 'Run a shell command.' },
  { name: 'process.start', category: 'runtime', baseRisk: 'process_exec', description: 'Start a (background) process.' },
  { name: 'process.status', category: 'runtime', baseRisk: 'read_only', description: 'Check a started process.' },
  { name: 'process.kill', category: 'runtime', baseRisk: 'destructive', description: 'Kill a started process.' },
  { name: 'code.execute', category: 'runtime', baseRisk: 'process_exec', description: 'Run agent-authored Python in an isolated Larund venv + throwaway run dir (input files copied in, output files/charts harvested out). For statistics, correlation, anomaly detection, custom transforms and chart generation that sheet.query cannot do. No filesystem-escape or network unless explicitly allowed (network always needs approval).' },
  { name: 'code.install_package', category: 'runtime', baseRisk: 'process_exec', description: 'Approval-gated pip install of ONE package outside the base allowlist into the Larund venv.' },

  { name: 'file.read', category: 'files', baseRisk: 'read_only', description: 'Read a file.' },
  { name: 'file.write', category: 'files', baseRisk: 'local_write', description: 'Write/overwrite a file.' },
  { name: 'file.edit', category: 'files', baseRisk: 'local_write', description: 'Find/replace edit a file.' },
  { name: 'file.list', category: 'files', baseRisk: 'read_only', description: 'List a directory.' },
  { name: 'file.mkdir', category: 'files', baseRisk: 'local_write', description: 'Create a directory.' },
  { name: 'file.copy', category: 'files', baseRisk: 'local_write', description: 'Copy a file/folder.' },
  { name: 'file.move', category: 'files', baseRisk: 'local_write', description: 'Move/rename a file/folder.' },
  { name: 'file.delete', category: 'files', baseRisk: 'destructive', description: 'Delete a file/folder (approval).' },
  { name: 'file.search', category: 'files', baseRisk: 'read_only', description: 'Search file contents.' },
  { name: 'file.tree', category: 'files', baseRisk: 'read_only', description: 'Print a directory tree.' },
  { name: 'file.exists', category: 'files', baseRisk: 'read_only', description: 'Check if a path exists.' },
  { name: 'file.metadata', category: 'files', baseRisk: 'read_only', description: 'Read file metadata.' },

  { name: 'document.read', category: 'documents', baseRisk: 'read_only', description: 'Read and extract a referenced document.' },
  { name: 'document.read_many', category: 'documents', baseRisk: 'read_only', description: 'Read several referenced documents.' },
  { name: 'folder.scan', category: 'documents', baseRisk: 'read_only', description: 'Inventory a folder recursively with limits.' },
  { name: 'folder.read_relevant', category: 'documents', baseRisk: 'read_only', description: 'Scan a folder and read relevant files.' },
  { name: 'document.summarize', category: 'documents', baseRisk: 'read_only', description: 'Read and summarize a document.' },

  { name: 'sheet.read', category: 'data', baseRisk: 'read_only', description: 'Read a spreadsheet/CSV.' },
  { name: 'sheet.write', category: 'data', baseRisk: 'local_write', description: 'Write a spreadsheet/CSV.' },
  { name: 'sheet.append', category: 'data', baseRisk: 'local_write', description: 'Append rows to a spreadsheet/CSV.' },
  { name: 'sheet.export_csv', category: 'data', baseRisk: 'local_write', description: 'Export a local sheet to CSV.' },
  { name: 'sheet.to_json', category: 'data', baseRisk: 'read_only', description: 'Read a local sheet as JSON.' },
  { name: 'sheet.profile', category: 'data', baseRisk: 'read_only', description: 'Profile a large sheet/CSV natively: per-column type/null/unique stats + numeric min/max/mean/sum + a small sample, without dumping raw rows. Use this FIRST for files over ~200 rows.' },
  { name: 'sheet.query', category: 'data', baseRisk: 'read_only', description: 'Filter/aggregate/group a sheet/CSV natively and return only the result (e.g. a sum or per-group totals), not raw rows. Use for exact answers over large data.' },
  { name: 'sheet.format_range', category: 'data', baseRisk: 'local_write', description: 'Apply native Excel formatting to a cell range: fill, font, border, number format, column width, freeze panes, and value-threshold conditional fills (e.g. red for negatives).' },
  { name: 'sheet.add_chart', category: 'data', baseRisk: 'local_write', description: 'Insert a native chart (bar/line/pie/area/doughnut/scatter) from sheet-qualified data ranges.' },
  { name: 'sheet.add_table', category: 'data', baseRisk: 'local_write', description: 'Create a native Excel Table (ListObject) over a header+data range for instant filter/sort.' },
  { name: 'doc.read', category: 'documents', baseRisk: 'read_only', description: 'Read a local document through the document reader.' },
  { name: 'doc.write_txt', category: 'documents', baseRisk: 'local_write', description: 'Write a local text document.' },
  { name: 'doc.write_docx', category: 'documents', baseRisk: 'local_write', description: 'Write a DOCX placeholder document.' },

  { name: 'artifact.plan', category: 'artifacts', baseRisk: 'read_only', description: 'Plan a local document artifact and choose format/template.' },
  { name: 'artifact.render_pdf', category: 'artifacts', baseRisk: 'local_write', description: 'Render a structured document model to a local PDF artifact.' },
  { name: 'artifact.render_docx', category: 'artifacts', baseRisk: 'local_write', description: 'Render a structured document model to an editable DOCX artifact.' },
  { name: 'artifact.render_pptx', category: 'artifacts', baseRisk: 'local_write', description: 'Render a structured presentation model to a PPTX artifact.' },
  { name: 'artifact.convert', category: 'artifacts', baseRisk: 'process_exec', description: 'Convert artifacts through a local fallback such as LibreOffice when available.' },
  { name: 'artifact.preview', category: 'artifacts', baseRisk: 'read_only', description: 'Generate or return local preview thumbnails for an artifact.' },
  { name: 'artifact.verify', category: 'artifacts', baseRisk: 'read_only', description: 'Verify an artifact exists, is readable, and contains expected text/counts.' },
  { name: 'artifact.design_lint', category: 'artifacts', baseRisk: 'read_only', description: 'Run the design + content quality gate on a rendered document (accents, structure, totals, embedded font).' },
  { name: 'presentation.quality_lint', category: 'artifacts', baseRisk: 'read_only', description: 'Run the presentation quality gate on a deck model (slide count, titles, visual variety, accents, not skeleton/overstuffed).' },
  { name: 'artifact.list', category: 'artifacts', baseRisk: 'read_only', description: 'List generated local artifacts.' },
  { name: 'artifact.open', category: 'artifacts', baseRisk: 'local_write', description: 'Open a generated local artifact with the OS default app.' },
  { name: 'artifact.copy_to', category: 'artifacts', baseRisk: 'local_write', description: 'Save a copy of an artifact to a selected local folder.' },
  { name: 'artifact.pdf_merge', category: 'artifacts', baseRisk: 'local_write', description: 'Merge PDF files into a new local PDF.' },
  { name: 'artifact.pdf_split', category: 'artifacts', baseRisk: 'local_write', description: 'Split a PDF into local output pages.' },
  { name: 'artifact.pdf_watermark', category: 'artifacts', baseRisk: 'local_write', description: 'Create a watermarked copy of a PDF.' },
  { name: 'artifact.pdf_extract_text', category: 'artifacts', baseRisk: 'read_only', description: 'Extract text from a PDF.' },
  { name: 'artifact.pdf_metadata', category: 'artifacts', baseRisk: 'read_only', description: 'Read PDF metadata.' },
  { name: 'artifact.pdf_page_count', category: 'artifacts', baseRisk: 'read_only', description: 'Count PDF pages.' },

  { name: 'clipboard.get', category: 'clipboard', baseRisk: 'read_only', description: 'Read the clipboard.' },
  { name: 'clipboard.set', category: 'clipboard', baseRisk: 'local_write', description: 'Set the clipboard.' },

  { name: 'app.open', category: 'apps', baseRisk: 'local_write', description: 'Launch/focus an app or URI.' },
  { name: 'window.list', category: 'apps', baseRisk: 'read_only', description: 'List open windows.' },
  { name: 'window.focus', category: 'apps', baseRisk: 'local_write', description: 'Focus a window.' },
  { name: 'keyboard.press', category: 'apps', baseRisk: 'local_write', description: 'Press one deterministic key.' },
  { name: 'keyboard.combo', category: 'apps', baseRisk: 'local_write', description: 'Press a deterministic shortcut.' },

  { name: 'browser.open', category: 'browser', baseRisk: 'external_read', description: 'Open a URL (CDP/DOM).' },
  { name: 'browser.read', category: 'browser', baseRisk: 'external_read', description: 'Read page URL/title/inputs/buttons/focus.' },
  { name: 'browser.get_state', category: 'browser', baseRisk: 'external_read', description: 'Get structured page state (URL/title/focus/inputs).' },
  { name: 'browser.click', category: 'browser', baseRisk: 'external_write', description: 'Click a DOM element by text/selector.' },
  { name: 'browser.type', category: 'browser', baseRisk: 'external_write', description: 'Type into a DOM field (errors on ambiguity).' },
  { name: 'browser.key', category: 'browser', baseRisk: 'external_write', description: 'Send a key to the page.' },
  { name: 'browser.shortcut', category: 'browser', baseRisk: 'external_write', description: 'Send a key combo (e.g. ctrl+v) to the page.' },
  { name: 'browser.paste', category: 'browser', baseRisk: 'external_write', description: 'Set clipboard (optional) and paste into the focused field/grid.' },
  { name: 'browser.assert_text', category: 'browser', baseRisk: 'external_read', description: 'Assert visible text is present on the page.' },
  { name: 'browser.assert_url', category: 'browser', baseRisk: 'external_read', description: 'Assert the current URL matches.' },
  { name: 'browser.wait', category: 'browser', baseRisk: 'external_read', description: 'Wait for text/selector.' },
  { name: 'browser.extract_table', category: 'browser', baseRisk: 'external_read', description: 'Extract a table as rows.' },
  { name: 'browser.download', category: 'browser', baseRisk: 'external_write', description: 'Download a file.' },
  { name: 'browser.upload', category: 'browser', baseRisk: 'external_write', description: 'Upload a file to an input.' },
  { name: 'browser.login', category: 'browser', baseRisk: 'credential_access', description: 'Sign in to a site using a SAVED login (pass {domain} or {url}). The password is filled from the vault automatically — never type or read passwords yourself.' },

  { name: 'email.compose', category: 'connections', baseRisk: 'external_write', description: 'Surface an editable email draft as a chat card; creates a real Gmail draft when Gmail is connected.' },
  { name: 'connection.call', category: 'connections', baseRisk: 'external_read', description: 'Call a connection tool.' },
  { name: 'skill.run', category: 'skills', baseRisk: 'local_write', description: 'Run a skill workflow.' },
  { name: 'workflow.start', category: 'workflows', baseRisk: 'local_write', description: 'Start a long-running workflow.' },
  { name: 'workflow.status', category: 'workflows', baseRisk: 'read_only', description: 'Check workflow status.' },
  { name: 'workflow.cancel', category: 'workflows', baseRisk: 'local_write', description: 'Cancel a workflow.' },

  { name: 'approval.request', category: 'approvals', baseRisk: 'read_only', description: 'Request human approval.' },
  { name: 'task.complete', category: 'runtime', baseRisk: 'read_only', description: 'Finish the task.' },
  { name: 'ask_user', category: 'runtime', baseRisk: 'read_only', description: 'Ask the user a question / manual handoff.' },
];

export function categoryOf(name: string): ToolCategory {
  return ACTION_CATEGORY[name] ?? 'runtime';
}

/** A short tool-catalog summary for the system prompt. */
export function toolCatalogSummary(): string {
  const byCat = new Map<ToolCategory, string[]>();
  for (const t of TOOL_CATALOG) {
    const arr = byCat.get(t.category) ?? [];
    arr.push(t.name);
    byCat.set(t.category, arr);
  }
  return [...byCat.entries()]
    .map(([cat, names]) => `- ${cat}: ${names.join(', ')}`)
    .join('\n');
}
