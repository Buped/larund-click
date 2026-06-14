import { invoke } from '@tauri-apps/api/core';

export interface SocDebugWriter {
  dir: string;
  writeText(name: string, content: string): Promise<void>;
  writeBase64(name: string, base64: string): Promise<void>;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function createSocDebugWriter(runId: string, step: number): SocDebugWriter {
  const dir = `~/.larund-click/soc-mode/${safeName(runId)}/step-${String(step).padStart(3, '0')}`;
  return {
    dir,
    async writeText(name, content) {
      try {
        await invoke('file_write', { path: `${dir}/${safeName(name)}`, content });
      } catch {
        // Debug artifacts must never break execution.
      }
    },
    async writeBase64(name, base64) {
      try {
        const fileName = safeName(name);
        await invoke('file_write', { path: `${dir}/${fileName}`, content: base64 });
        await invoke('file_write', { path: `${dir}/${fileName}.base64`, content: base64 });
      } catch {
        // Debug artifacts must never break execution.
      }
    },
  };
}
