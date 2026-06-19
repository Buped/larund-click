// Browser profile registry. Lets a user choose which Chromium-based browser Larund
// drives for a given app. Larund automates browsers over CDP only, so the choices
// are: a managed Agent Chrome (default), a managed Agent Edge, a custom Chromium
// executable, or an already-running CDP endpoint. A normal everyday browser cannot
// be driven unless it was started with a remote-debugging port.

export type BrowserKind = 'agent_chrome' | 'agent_edge' | 'custom_chromium' | 'existing_cdp';

export interface BrowserProfile {
  id: string;
  label: string;
  kind: BrowserKind;
  /** Path to a Chromium/Edge executable (custom_chromium; optional for agent_edge). */
  executablePath?: string;
  /** Dedicated user-data dir to isolate the automation session. */
  profileDir?: string;
  /** Port to launch the browser with --remote-debugging-port on. */
  remoteDebuggingPort?: number;
  /** Full CDP endpoint for an already-running browser (existing_cdp), e.g. http://localhost:9223. */
  cdpEndpoint?: string;
  isDefault?: boolean;
}

/** The built-in managed default — always present, never deletable. */
export const DEFAULT_BROWSER_PROFILE: BrowserProfile = {
  id: 'agent-chrome',
  label: 'Agent Chrome (managed)',
  kind: 'agent_chrome',
  isDefault: true,
};

const STORE_KEY = 'browser_profiles';

let profiles: BrowserProfile[] = [];
let hydrated = false;

function uuid(): string {
  try { return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `bp-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
  catch { return `bp-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
}
function persist(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(profiles)); } catch { /* node/tests */ }
}
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) profiles = JSON.parse(raw) as BrowserProfile[]; } catch { /* ignore */ }
}

export function listBrowserProfiles(): BrowserProfile[] {
  hydrate();
  // The managed default is always offered first.
  return [DEFAULT_BROWSER_PROFILE, ...profiles.filter((p) => p.id !== DEFAULT_BROWSER_PROFILE.id)];
}

export function getBrowserProfile(id: string | undefined): BrowserProfile | undefined {
  if (!id) return undefined;
  if (id === DEFAULT_BROWSER_PROFILE.id) return DEFAULT_BROWSER_PROFILE;
  hydrate();
  return profiles.find((p) => p.id === id);
}

export interface ValidationResult { ok: boolean; error?: string }

/** Validate a profile config before saving. Surfaces honest, actionable errors. */
export function validateBrowserProfile(p: Partial<BrowserProfile>): ValidationResult {
  switch (p.kind) {
    case 'agent_chrome':
    case 'agent_edge':
      return { ok: true };
    case 'custom_chromium':
      if (!p.executablePath?.trim()) return { ok: false, error: 'A path to a Chromium-based browser executable is required.' };
      return { ok: true };
    case 'existing_cdp':
      if (!p.cdpEndpoint?.trim()) return { ok: false, error: 'A CDP endpoint URL is required (e.g. http://localhost:9223).' };
      try {
        const u = new URL(p.cdpEndpoint);
        if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'CDP endpoint must be an http(s) URL.' };
      } catch { return { ok: false, error: 'CDP endpoint is not a valid URL.' }; }
      return { ok: true };
    default:
      return { ok: false, error: 'Larund can only automate Chromium-based browsers (Chrome/Edge/Chromium) through CDP right now.' };
  }
}

export function createBrowserProfile(input: Omit<BrowserProfile, 'id'>): BrowserProfile {
  hydrate();
  const v = validateBrowserProfile(input);
  if (!v.ok) throw new Error(v.error);
  const profile: BrowserProfile = { ...input, id: uuid(), isDefault: false };
  profiles.push(profile);
  persist();
  return profile;
}

export function updateBrowserProfile(id: string, patch: Partial<Omit<BrowserProfile, 'id'>>): BrowserProfile | undefined {
  hydrate();
  const p = profiles.find((x) => x.id === id);
  if (!p) return undefined;
  Object.assign(p, patch);
  const v = validateBrowserProfile(p);
  if (!v.ok) throw new Error(v.error);
  persist();
  return p;
}

export function deleteBrowserProfile(id: string): void {
  hydrate();
  profiles = profiles.filter((p) => p.id !== id);
  persist();
}

export function __resetBrowserProfilesForTests(): void {
  profiles = [];
  hydrated = false;
}
