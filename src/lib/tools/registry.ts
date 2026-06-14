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

  { name: 'sheet.read', category: 'data', baseRisk: 'read_only', description: 'Read a spreadsheet/CSV.' },
  { name: 'sheet.write', category: 'data', baseRisk: 'local_write', description: 'Write a spreadsheet/CSV.' },

  { name: 'clipboard.get', category: 'clipboard', baseRisk: 'read_only', description: 'Read the clipboard.' },
  { name: 'clipboard.set', category: 'clipboard', baseRisk: 'local_write', description: 'Set the clipboard.' },

  { name: 'app.open', category: 'apps', baseRisk: 'local_write', description: 'Launch/focus an app or URI.' },
  { name: 'window.list', category: 'apps', baseRisk: 'read_only', description: 'List open windows.' },
  { name: 'window.focus', category: 'apps', baseRisk: 'local_write', description: 'Focus a window.' },
  { name: 'keyboard.press', category: 'apps', baseRisk: 'local_write', description: 'Press one deterministic key.' },
  { name: 'keyboard.combo', category: 'apps', baseRisk: 'local_write', description: 'Press a deterministic shortcut.' },

  { name: 'browser.open', category: 'browser', baseRisk: 'external_read', description: 'Open a URL (CDP/DOM).' },
  { name: 'browser.read', category: 'browser', baseRisk: 'external_read', description: 'Read page text/DOM.' },
  { name: 'browser.click', category: 'browser', baseRisk: 'external_write', description: 'Click a DOM element by text/selector.' },
  { name: 'browser.type', category: 'browser', baseRisk: 'external_write', description: 'Type into a DOM field.' },
  { name: 'browser.key', category: 'browser', baseRisk: 'external_write', description: 'Send a key to the page.' },
  { name: 'browser.wait', category: 'browser', baseRisk: 'external_read', description: 'Wait for text/selector.' },
  { name: 'browser.extract_table', category: 'browser', baseRisk: 'external_read', description: 'Extract a table as rows.' },
  { name: 'browser.download', category: 'browser', baseRisk: 'external_write', description: 'Download a file.' },
  { name: 'browser.upload', category: 'browser', baseRisk: 'external_write', description: 'Upload a file to an input.' },

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
