// Theme controller. The whole app is driven by CSS tokens in index.css;
// this module just decides which token set is active by toggling the
// `data-theme` attribute on <html>. Dark is the default (:root); light is
// applied via `:root[data-theme="light"]`.

export type ThemePref = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'larund_theme';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** Resolve a preference (which may be "system") to a concrete theme. */
export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return pref;
}

/** Read the stored preference (defaults to dark). */
export function getStoredThemePref(): ThemePref {
  const raw = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || '';
  return raw === 'light' || raw === 'system' ? raw : 'dark';
}

/** Apply a resolved theme to the document root. */
function applyResolved(resolved: 'dark' | 'light'): void {
  const root = document.documentElement;
  if (resolved === 'light') root.setAttribute('data-theme', 'light');
  else root.setAttribute('data-theme', 'dark');
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

/**
 * Set and persist the theme preference, apply it immediately, and keep it
 * in sync with the OS when the preference is "system".
 */
export function setTheme(pref: ThemePref): void {
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* ignore */ }
  applyResolved(resolveTheme(pref));

  // Manage the system-change listener only while "system" is selected.
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (mq) {
    if (mediaListener) { mq.removeEventListener('change', mediaListener); mediaListener = null; }
    if (pref === 'system') {
      mediaListener = () => applyResolved(resolveTheme('system'));
      mq.addEventListener('change', mediaListener);
    }
  }
}

/** Apply the stored theme. Call once at startup (before first paint ideally). */
export function initTheme(): void {
  setTheme(getStoredThemePref());
}

/** Map the Settings select label / stored value to a ThemePref. */
export function themePrefFromSetting(value: string | null | undefined): ThemePref {
  const v = (value || '').toLowerCase();
  return v === 'light' || v === 'system' ? v : 'dark';
}

/** Human label for the select control. */
export function themeLabel(pref: ThemePref): string {
  return pref === 'light' ? 'Light' : pref === 'system' ? 'System' : 'Dark';
}
