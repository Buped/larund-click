// Minimal built-in SVG icon set for slide visuals (no external assets / hotlinks).
// Stroke icons on a 24x24 grid; `currentColor` is replaced at render time.

import type { IconName } from './types';

const PATHS: Record<IconName, string> = {
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 12l3 3M14.5 5.5c3-3 6-2.5 6-2.5s.5 3-2.5 6c-2 2-5.5 4-7 4.5L10.5 11C11 9.5 12.5 7.5 14.5 5.5Z"/><circle cx="15" cy="9" r="1.4"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 4 3 3 0 0 0 5 1V5a3 3 0 0 0-2-1Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 4 3 3 0 0 1-5 1"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"/>',
  document: '<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  chart: '<path d="M4 20V4M20 20H4M8 16v-4M12 16V8M16 16v-6"/>',
  workflow: '<rect x="3" y="4" width="6" height="5" rx="1.2"/><rect x="15" y="15" width="6" height="5" rx="1.2"/><path d="M9 6.5h4a2 2 0 0 1 2 2v9"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  warning: '<path d="M12 3l9 16H3L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M16.5 14.5A5.5 5.5 0 0 1 20.5 20"/>',
};

export function iconSvg(name: IconName, color: string, size = 28): string {
  const body = PATHS[name] ?? PATHS.spark;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function isIconName(value: string): value is IconName {
  return value in PATHS;
}
