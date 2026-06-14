import type { SocPortMode } from './types';

export const SOC_PORT_DEFAULT_MODEL = 'openai/gpt-4o';
export const SOC_PORT_FALLBACK_MODEL = 'openai/gpt-4.1';
export const SOC_PORT_CHEAP_MODEL = 'qwen/qwen3-vl-32b-instruct';

function readSetting(key: string, fallback: string): string {
  const envValue = ((import.meta.env[key] as string | undefined)
    ?? (import.meta.env[`VITE_${key}`] as string | undefined))?.trim();
  if (envValue) return envValue;
  try {
    const stored = globalThis.localStorage?.getItem(key)?.trim();
    if (stored) return stored;
  } catch {
    // localStorage is unavailable in tests.
  }
  return fallback;
}

export function getSocPortConfig(): { mode: SocPortMode; model: string; fallbackModel: string; maxSteps: number } {
  return {
    mode: readSetting('SOC_PORT_MODE', 'ocr') as SocPortMode,
    model: readSetting('SOC_MODEL_PRIMARY', SOC_PORT_DEFAULT_MODEL),
    fallbackModel: readSetting('SOC_MODEL_FALLBACK', SOC_PORT_FALLBACK_MODEL),
    maxSteps: Number(readSetting('SOC_MAX_STEPS', '12')) || 12,
  };
}
