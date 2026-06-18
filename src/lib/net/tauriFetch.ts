// CORS-free HTTP. In the Tauri desktop app, requests run through the Rust
// `http_request` command so endpoints that omit CORS headers (OAuth token
// endpoints like oauth2.googleapis.com/token) work. Outside Tauri (tests, web)
// it falls back to the standard `fetch`.

export interface SimpleResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export interface SimpleRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
  } catch {
    return false;
  }
}

export async function tauriFetch(url: string, init: SimpleRequestInit = {}): Promise<SimpleResponse> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ status: number; body: string }>('http_request', {
      method: init.method ?? 'GET',
      url,
      headers: init.headers ?? {},
      body: init.body,
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  }
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { ok: res.ok, status: res.status, text: () => res.text() };
}
