import { invoke } from '@tauri-apps/api/core';
import type { SocPortScreenshot } from './types';

export async function takeSocScreenshot(): Promise<SocPortScreenshot> {
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

export function imageDataUrl(screenshot: SocPortScreenshot, base64 = screenshot.base64): string {
  return `data:image/jpeg;base64,${base64}`;
}
