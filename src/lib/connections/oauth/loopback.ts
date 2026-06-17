// Loopback OAuth capture (desktop). Wraps the Rust `tauri-plugin-oauth` plugin:
// it starts a localhost server, the provider redirects the system browser to
// `http://localhost:<port>/`, and the plugin emits the full callback URL back to
// the app. We keep the exact plugin command/event names isolated here.
//
// Commands: `plugin:oauth|start` ({ config }) -> port, `plugin:oauth|cancel` ({ port }).
// Events:   `oauth://url` (payload = redirect URL), `oauth://invalid-url`.

import { getProviderSecret } from '../env/resolve';

export interface LoopbackHandle {
  port: number;
  /** Resolve with the full callback URL the provider redirected to. */
  waitForRedirect(timeoutMs?: number): Promise<string>;
  /** Stop the loopback server. */
  cancel(): Promise<void>;
}

const DEFAULT_PORT = 14200;
const DEFAULT_TIMEOUT_MS = 180_000;

function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  } catch {
    return false;
  }
}

/** Fixed loopback port from LARUND_OAUTH_CALLBACK_BASE so provider consoles match. */
export function preferredLoopbackPort(): number {
  const base = getProviderSecret('', 'LARUND_OAUTH_CALLBACK_BASE');
  if (base) {
    try {
      const port = new URL(base).port;
      if (port) return Number(port);
    } catch { /* ignore */ }
  }
  return DEFAULT_PORT;
}

const SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Connected</title></head>' +
  '<body style="font-family:system-ui;background:#0b1220;color:#e6edf6;display:grid;place-items:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>✓ Connected to Larund</h2>' +
  '<p style="opacity:.7">You can close this tab and return to the app.</p></div></body></html>';

export async function startLoopback(opts: { port?: number } = {}): Promise<LoopbackHandle> {
  if (!isTauri()) {
    throw new Error('oauth_loopback_unavailable: connecting an account requires the Larund desktop app.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const port = await invoke<number>('plugin:oauth|start', {
    config: { ports: [opts.port ?? preferredLoopbackPort()], response: SUCCESS_HTML },
  });

  return {
    port,
    waitForRedirect(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        const unlisteners: Array<() => void> = [];
        const cleanup = () => {
          clearTimeout(timer);
          for (const u of unlisteners) { try { u(); } catch { /* ignore */ } }
        };
        const finish = (run: () => void) => { if (!settled) { settled = true; cleanup(); run(); } };
        const timer = setTimeout(
          () => finish(() => reject(new Error('oauth_cancelled: timed out waiting for the provider redirect.'))),
          timeoutMs,
        );
        listen<string>('oauth://url', (e) => finish(() => resolve(e.payload))).then((u) => unlisteners.push(u));
        listen<string>('oauth://invalid-url', (e) => finish(() => reject(new Error(`oauth_invalid_redirect: ${e.payload}`)))).then((u) => unlisteners.push(u));
      });
    },
    async cancel(): Promise<void> {
      try { await invoke('plugin:oauth|cancel', { port }); } catch { /* best effort */ }
    },
  };
}
