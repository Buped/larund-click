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

// Shown in the user's browser at the end of the OAuth redirect. The app already
// captured the token via the `oauth://url` event, so this tab is purely cosmetic —
// we attempt to close it automatically (browsers may block this for tabs they did
// not open via script) and otherwise show a clean "you can close this" message.
const SUCCESS_HTML =
  '<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>Larund – csatlakozva</title>' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1220;color:#e6edf6;display:grid;place-items:center;height:100vh;margin:0">' +
  '<div style="text-align:center;max-width:420px;padding:24px">' +
  '<div style="font-size:46px;line-height:1;margin-bottom:10px">✓</div>' +
  '<h2 style="margin:0 0 8px;font-size:22px">Sikeresen csatlakoztál a Larundhoz</h2>' +
  '<p style="opacity:.7;margin:0 0 4px">Visszatérhetsz az alkalmazásba — ez az ablak bezárható.</p>' +
  '<p id="hint" style="opacity:.45;font-size:13px;margin:14px 0 0"></p></div>' +
  '<script>(function(){try{window.close();}catch(e){}' +
  'setTimeout(function(){try{window.close();}catch(e){}' +
  'var h=document.getElementById("hint");if(h)h.textContent="Bezárhatod ezt a lapot.";},400);})();</script>' +
  '</body></html>';

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
