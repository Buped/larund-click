// Vision Mouse V2 — DOM provider.
//
// Wraps the existing CDP `browser_read` command (src-tauri/src/commands/browser.rs).
// browser_read returns a TEXT list (no pixel bboxes), shaped like:
//
//   URL: https://example.com
//   TITLE: Example
//   CLICKABLE/INPUTS:
//   a: Sign in
//   button: New project
//   input[email]: Email
//
// So DOM elements have NO screen coordinates — they are acted on by the executor
// via browser_click / browser_type using their visible text, which is exactly
// the "DOM locator, not pixels" philosophy. bbox is [0,0,0,0]; the merger
// excludes DOM elements from pixel/IoU dedup and dedups them by text/role only.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenElement } from '../types';

const NO_BBOX = [0, 0, 0, 0] as [number, number, number, number];

export interface DomReadResult {
  url: string;
  title: string;
  elements: ScreenElement[];
}

/** Map a browser_read tag like "input[email]" to a role + input flag. */
function roleForTag(tag: string): { role: string; isInput: boolean } {
  const base = tag.split('[')[0].toLowerCase();
  const isInput = base === 'input' || base === 'textarea' || base === 'select';
  const role =
    base === 'a' ? 'Hyperlink'
    : base === 'button' ? 'Button'
    : isInput ? 'Edit'
    : base || 'Element';
  return { role, isInput };
}

/** Parse the raw browser_read text into a structured DOM read result. */
export function parseBrowserRead(text: string): DomReadResult {
  const lines = (text ?? '').split('\n');
  let url = '';
  let title = '';
  let inList = false;
  const elements: ScreenElement[] = [];
  let i = 0;
  for (const line of lines) {
    if (line.startsWith('URL:')) { url = line.slice(4).trim(); continue; }
    if (line.startsWith('TITLE:')) { title = line.slice(6).trim(); continue; }
    if (line.startsWith('CLICKABLE/INPUTS:')) { inList = true; continue; }
    if (!inList) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    const tag = sep >= 0 ? trimmed.slice(0, sep).trim() : trimmed;
    const label = sep >= 0 ? trimmed.slice(sep + 1).trim() : '';
    const { role, isInput } = roleForTag(tag);
    // Target the executor uses with browser_click/browser_type: prefer the
    // visible label; fall back to the tag for nameless inputs.
    const domTarget = label || tag;
    elements.push({
      id: `dom_${i++}`,
      source: 'dom',
      role,
      name: label,
      text: label,
      bbox: NO_BBOX,
      center: [0, 0],
      clickable_point: [0, 0],
      clickable: true,
      confidence: 0.9, // DOM is the most reliable source
      visible: true,
      metadata: { domTarget, tag, isInput, url },
    });
  }
  return { url, title, elements };
}

/**
 * Read the active page's DOM elements via CDP. Caller is responsible for only
 * invoking this when a browser context is actually active (browser_read would
 * otherwise auto-launch Chrome) — see screen-state.ts gating + browser_probe.
 */
export async function readDomElements(): Promise<DomReadResult> {
  const text = await invoke<string>('browser_read');
  return parseBrowserRead(text);
}

/** Non-launching probe: is the agent Chrome already running? */
export async function isBrowserOpen(): Promise<boolean> {
  try {
    return await invoke<boolean>('browser_probe');
  } catch {
    return false;
  }
}
