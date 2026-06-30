import { normalizeDomain } from '../credentials/store';

const SETTINGS_KEY = 'browser_native_autofill_settings';
let memorySettings: NativeAutofillSettings = { enabled: false, successfulDomains: [] };

export interface NativeAutofillSettings {
  enabled: boolean;
  successfulDomains: string[];
}

const DEFAULT_SETTINGS: NativeAutofillSettings = { enabled: false, successfulDomains: [] };

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getNativeAutofillSettings(): NativeAutofillSettings {
  const raw = safeStorage()?.getItem(SETTINGS_KEY);
  if (!raw) return { ...memorySettings, successfulDomains: [...memorySettings.successfulDomains] };
  try {
    const parsed = JSON.parse(raw) as Partial<NativeAutofillSettings>;
    return {
      enabled: parsed.enabled === true,
      successfulDomains: Array.isArray(parsed.successfulDomains)
        ? [...new Set(parsed.successfulDomains.map((d) => normalizeDomain(d)).filter(Boolean))].sort()
        : [],
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setNativeAutofillEnabled(enabled: boolean): NativeAutofillSettings {
  const next = { ...getNativeAutofillSettings(), enabled };
  memorySettings = { ...next, successfulDomains: [...next.successfulDomains] };
  safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function markNativeAutofillSuccess(domainOrUrl: string): NativeAutofillSettings {
  const domain = normalizeDomain(domainOrUrl);
  const current = getNativeAutofillSettings();
  if (!domain) return current;
  const next = {
    ...current,
    successfulDomains: [...new Set([...current.successfulDomains, domain])].sort(),
  };
  memorySettings = { ...next, successfulDomains: [...next.successfulDomains] };
  safeStorage()?.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function __resetNativeAutofillSettingsForTests(): void {
  memorySettings = { ...DEFAULT_SETTINGS };
  safeStorage()?.removeItem(SETTINGS_KEY);
}
