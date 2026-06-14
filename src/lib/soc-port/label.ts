import { invoke } from '@tauri-apps/api/core';
import type { SocPortLabelMap, SocPortScreenshot } from './types';

export async function buildSocLabels(screenshot: SocPortScreenshot): Promise<SocPortLabelMap> {
  const raw = await invoke<string>('soc_label_yolo', { screenshotBase64: screenshot.base64 });
  const parsed = JSON.parse(raw) as { labeled_screenshot_base64?: string; label_coordinates?: Record<string, [number, number, number, number]>; error?: string };
  if (parsed.error) throw new Error(`soc_label_failed:${parsed.error}`);
  return {
    labeledImageBase64: parsed.labeled_screenshot_base64 || screenshot.base64,
    labelCoordinates: parsed.label_coordinates || {},
  };
}
