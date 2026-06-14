import { invoke } from '@tauri-apps/api/core';
import type { SocScreenshot } from './types';

export async function takeDesktopScreenshot(): Promise<SocScreenshot> {
  const shot = await invoke<{ base64: string; width: number; height: number; monitor_id?: number; monitorId?: number }>(
    'capture_screen_raw',
    { monitorId: null },
  );
  return {
    base64: shot.base64,
    width: shot.width,
    height: shot.height,
    monitorId: shot.monitorId ?? shot.monitor_id ?? 0,
  };
}

export function screenshotDataUrl(screenshot: SocScreenshot, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${screenshot.base64}`;
}
