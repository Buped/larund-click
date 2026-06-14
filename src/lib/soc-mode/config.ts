import type { SocMode } from './types';

export const SOC_MODEL_PRIMARY = 'openai/gpt-4o';
export const SOC_MODEL_FALLBACK = 'openai/gpt-4.1';
export const SOC_MODEL_VISUAL_CHEAP = 'qwen/qwen3-vl-32b-instruct';

export interface SocConfig {
  mode: SocMode;
  primaryModel: string;
  fallbackModel: string;
  cheapModel: string;
  maxSteps: number;
  noChangeThreshold: number;
}

function readSetting(key: string, fallback: string): string {
  const envValue = ((import.meta.env[key] as string | undefined)
    ?? (import.meta.env[`VITE_${key}`] as string | undefined))?.trim();
  if (envValue) return envValue;
  try {
    const stored = globalThis.localStorage?.getItem(key)?.trim();
    if (stored) return stored;
  } catch {
    // localStorage is optional in tests and non-browser contexts.
  }
  return fallback;
}

export function getSocConfig(): SocConfig {
  return {
    mode: (readSetting('SOC_MODE', 'hybrid-ocr-labeled') as SocMode),
    primaryModel: readSetting('SOC_MODEL_PRIMARY', SOC_MODEL_PRIMARY),
    fallbackModel: readSetting('SOC_MODEL_FALLBACK', SOC_MODEL_FALLBACK),
    cheapModel: readSetting('SOC_MODEL_VISUAL_CHEAP', SOC_MODEL_VISUAL_CHEAP),
    maxSteps: Number(readSetting('SOC_MAX_STEPS', '18')) || 18,
    noChangeThreshold: Number(readSetting('SOC_NO_CHANGE_THRESHOLD', '0.0015')) || 0.0015,
  };
}
