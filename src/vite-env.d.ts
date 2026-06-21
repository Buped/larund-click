/// <reference types="vite/client" />

declare module '@tauri-apps/plugin-dialog' {
  export function open(options?: {
    directory?: boolean;
    multiple?: boolean;
  }): Promise<string | string[] | null>;
  export function save(options?: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
}
