// Vision Mouse V2 — app-specific stable hotkey registry.
//
// Hotkeys are the most reliable actuator of all — no pixels, no UIA tree, no
// race. The planner is told about the relevant shortcuts for the foreground app
// and prefers them; the executor maps a `hotkey` ActionPlan to key_combo.
//
// `intent` is a free-text hint (the planner's chosen target text or goal); we
// match it against each shortcut's keyword list.

export interface AppShortcut {
  intent: string;        // canonical action name
  keys: string[];        // key_combo payload
  keywords: string[];    // match terms (lowercased)
  /** Sends/commits data → executor must route through the safety gate. */
  risky?: boolean;
}

export interface AppShortcutSet {
  /** Lowercased substrings matched against the active window title / app name. */
  match: string[];
  shortcuts: AppShortcut[];
}

export const SHORTCUT_REGISTRY: AppShortcutSet[] = [
  {
    match: ['visual studio code', 'vs code', 'vscode', '- code'],
    shortcuts: [
      { intent: 'extensions', keys: ['ctrl', 'shift', 'x'], keywords: ['extension', 'extensions', 'bővítmén', 'kiterjeszt'] },
      { intent: 'command_palette', keys: ['ctrl', 'shift', 'p'], keywords: ['command palette', 'parancs', 'command'] },
      { intent: 'terminal', keys: ['ctrl', '`'], keywords: ['terminal', 'konzol'] },
      { intent: 'file_search', keys: ['ctrl', 'p'], keywords: ['open file', 'file search', 'quick open', 'fájl keres'] },
      { intent: 'search', keys: ['ctrl', 'shift', 'f'], keywords: ['search', 'find in files', 'keresés'] },
    ],
  },
  {
    match: ['chrome', 'chromium', 'edge', 'firefox', 'mozilla', 'browser', 'böngész'],
    shortcuts: [
      { intent: 'address_bar', keys: ['ctrl', 'l'], keywords: ['address bar', 'url', 'címsor', 'address', 'omnibox', 'location bar'] },
      { intent: 'find', keys: ['ctrl', 'f'], keywords: ['find', 'find on page', 'keres'] },
      { intent: 'reload', keys: ['ctrl', 'r'], keywords: ['reload', 'refresh', 'frissít', 'újratölt'] },
      { intent: 'new_tab', keys: ['ctrl', 't'], keywords: ['new tab', 'új lap', 'új fül'] },
      { intent: 'close_tab', keys: ['ctrl', 'w'], keywords: ['close tab', 'lap bezár', 'fül bezár'] },
    ],
  },
];

/** All shortcuts whose app-set matches the active window/app. */
export function shortcutsForWindow(windowTitle: string, appName = ''): AppShortcut[] {
  const hay = `${windowTitle} ${appName}`.toLowerCase();
  const set = SHORTCUT_REGISTRY.find((s) => s.match.some((m) => hay.includes(m)));
  return set?.shortcuts ?? [];
}

/** Best shortcut for an intent string in the current app, or null. */
export function suggestShortcut(windowTitle: string, intent: string, appName = ''): AppShortcut | null {
  const want = (intent ?? '').toLowerCase();
  if (!want) return null;
  for (const sc of shortcutsForWindow(windowTitle, appName)) {
    if (sc.intent === want) return sc;
    if (sc.keywords.some((k) => want.includes(k) || k.includes(want))) return sc;
  }
  return null;
}

/** Compact "intent=keys" hints for the planner prompt. */
export function shortcutHints(windowTitle: string, appName = ''): string {
  return shortcutsForWindow(windowTitle, appName)
    .map((s) => `${s.intent}=${s.keys.join('+')}`)
    .join(', ');
}
