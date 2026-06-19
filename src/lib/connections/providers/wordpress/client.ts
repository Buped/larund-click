// WordPress REST client. WordPress sites are arbitrary third-party origins that do
// not send CORS headers, so requests go through the Rust `http_request` command
// (CORS-free curl) — never browser fetch. Auth is HTTP Basic with an application
// password; the credential never appears in the action args, model context, audit or
// UI (it is read from resolved secrets here and only put on the request header).

import { invoke } from '@tauri-apps/api/core';

export interface WpSecrets {
  WORDPRESS_SITE_URL?: string;
  WORDPRESS_USERNAME?: string;
  WORDPRESS_APP_PASSWORD?: string;
}

function base64(input: string): string {
  const g = globalThis as unknown as {
    btoa?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  // Browser/webview + Node 16+ both expose btoa; UTF-8 safe.
  if (typeof g.btoa === 'function') return g.btoa(unescape(encodeURIComponent(input)));
  if (g.Buffer) return g.Buffer.from(input, 'utf-8').toString('base64');
  return input;
}

export function wpAuthMissing(secrets: Record<string, string>): boolean {
  return !secrets.WORDPRESS_SITE_URL || !secrets.WORDPRESS_USERNAME || !secrets.WORDPRESS_APP_PASSWORD;
}

export interface WpResponse {
  status: number;
  body: string;
  json: unknown;
}

export function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Make an authenticated WordPress REST call. `path` starts after `/wp-json`. */
export async function wpRequest(
  secrets: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<WpResponse> {
  const base = String(secrets.WORDPRESS_SITE_URL ?? '').replace(/\/+$/, '');
  const auth = base64(`${secrets.WORDPRESS_USERNAME ?? ''}:${secrets.WORDPRESS_APP_PASSWORD ?? ''}`);
  const res = await invoke<{ status: number; body: string }>('http_request', {
    method,
    url: `${base}/wp-json${path}`,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  let json: unknown;
  try {
    json = res.body ? JSON.parse(res.body) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, body: res.body, json };
}
