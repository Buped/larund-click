import type { ControlAction, ControlActionName } from './types';

// The complete, closed set of actions the no-mouse operator may emit.
export const ALLOWED_ACTIONS: ReadonlySet<ControlActionName> = new Set<ControlActionName>([
  // runtime
  'cli.run', 'process.start', 'process.status', 'process.kill',
  // files
  'file.read', 'file.write', 'file.edit', 'file.list', 'file.mkdir',
  'file.copy', 'file.move', 'file.delete', 'file.search', 'file.tree',
  'file.exists', 'file.metadata',
  'document.read', 'document.read_many', 'document.summarize',
  'folder.scan', 'folder.read_relevant',
  // data
  'sheet.read', 'sheet.write', 'sheet.append', 'sheet.export_csv', 'sheet.to_json',
  'doc.read', 'doc.write_txt', 'doc.write_docx',
  // artifacts
  'artifact.plan', 'artifact.render_pdf', 'artifact.render_docx', 'artifact.render_pptx',
  'artifact.convert', 'artifact.preview', 'artifact.verify', 'artifact.design_lint', 'artifact.list',
  'artifact.open', 'artifact.copy_to', 'artifact.pdf_merge', 'artifact.pdf_split',
  'artifact.pdf_watermark', 'artifact.pdf_extract_text', 'artifact.pdf_metadata',
  'artifact.pdf_page_count', 'presentation.quality_lint',
  // clipboard
  'clipboard.get', 'clipboard.set',
  // apps / windows / keyboard
  'app.open', 'window.list', 'window.focus', 'keyboard.press', 'keyboard.combo',
  // browser
  'browser.open', 'browser.read', 'browser.get_state', 'browser.click', 'browser.type',
  'browser.key', 'browser.shortcut', 'browser.paste', 'browser.assert_text', 'browser.assert_url',
  'browser.wait', 'browser.extract_table', 'browser.download', 'browser.upload', 'browser.login',
  // email composer
  'email.compose',
  // connections / skills / workflows
  'connection.call', 'skill.run', 'workflow.start', 'workflow.status', 'workflow.cancel',
  // control flow
  'approval.request', 'task.complete', 'ask_user',
]);

/**
 * Migration guard. Returns true for any retired mouse / cursor / visual / SOC
 * action name. The agent core no longer supports these; the loop uses this to
 * reject and re-instruct the model instead of silently failing. Kept as a guard
 * (not deleted) so the no-mouse contract is provable in tests.
 */
export function isLegacyVisualActionName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    /^mouse[._]/.test(n) ||
    /^soc[._]/.test(n) ||
    /^visual[._]/.test(n) ||
    /^cursor[._]/.test(n) ||
    n === 'desktop_click_point' ||
    n === 'click_visual_target' ||
    n === 'ground_visual_target' ||
    n === 'soc.visual' ||
    /mouse_(click|double_click|move|drag)/.test(n) ||
    /(click|tap|ground)_?(visual|target|point|bbox|coordinate)/.test(n) ||
    /\b(bbox|ocr[_ ]?click|grid_click|screenshot_click)\b/.test(n)
  );
}

/** Back-compat alias retained for existing imports/tests. */
export const isRawMouseActionName = isLegacyVisualActionName;

function extractJson(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}$/);
  if (match) return match[0];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : null;
}

/**
 * Parses one structured action from a model turn. Returns null when the JSON is
 * missing/invalid OR when the action is not in the allowed no-mouse set. Legacy
 * visual/mouse actions are explicitly rejected (return null).
 */
export function parseControlAction(text: string): ControlAction | null {
  const json = extractJson(text);
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const action = String(raw.action ?? raw.tool ?? '');
  if (!action) return null;
  if (isLegacyVisualActionName(action)) return null;
  if (!ALLOWED_ACTIONS.has(action as ControlActionName)) return null;
  return { ...raw, action } as ControlAction;
}
