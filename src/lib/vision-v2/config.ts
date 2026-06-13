// Vision Mouse V2 — feature flag resolution.
//
// V2 is an OPT-IN, additive perception/grounding layer. When the flag is OFF
// (the default) the agent loop behaves exactly as before — the legacy grid +
// raw-mouse path. Turning it on routes screen perception through the unified
// ScreenState pipeline and the element-first action executor.
//
// Resolution order (first hit wins), so it can be toggled from any layer:
//   1. Vite build-time env var  VITE_LARUND_CLICK_VISION_V2 = "true"
//   2. localStorage             "larund_click_vision_v2"     = "true"
//   3. tauri-plugin-store key   "vision_v2"                  = true   (async)
//   4. default                  false
//
// The sync check (1+2) is enough for the agent loop's branch decision; the
// async store lookup is offered for the settings UI to persist a user choice.

const ENV_FLAG = 'VITE_LARUND_CLICK_VISION_V2';
const LS_KEY = 'larund_click_vision_v2';
const STORE_KEY = 'vision_v2';

function envEnabled(): boolean {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env?.[ENV_FLAG];
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

function lsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Synchronous best-effort check (env + localStorage). Safe everywhere. */
export function isVisionV2Enabled(): boolean {
  return envEnabled() || lsEnabled();
}

/**
 * Full async check that also consults the tauri-plugin-store, matching how
 * `autonomy_mode` is persisted in onboarding. Falls back to the sync result.
 */
export async function resolveVisionV2Enabled(): Promise<boolean> {
  if (isVisionV2Enabled()) return true;
  try {
    // Same store file the rest of the app uses (see Onboarding.tsx).
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('auth.dat');
    const v = await store.get<boolean>(STORE_KEY);
    return v === true;
  } catch {
    return false;
  }
}

/** Persist the user's choice to localStorage + the tauri store. */
export async function setVisionV2Enabled(enabled: boolean): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, enabled ? 'true' : 'false');
  } catch { /* ignore */ }
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('auth.dat');
    await store.set(STORE_KEY, enabled);
    await store.save();
  } catch { /* ignore */ }
}
