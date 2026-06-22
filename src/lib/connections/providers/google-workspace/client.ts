// Shared Google API plumbing for every Google Workspace sub-service.
//
// Responsibilities:
//   - one `googleApiFetch` that throws a typed `GoogleApiError` on non-2xx,
//   - `mapGoogleError` → human-readable, actionable (Hungarian) message instead of
//     a raw `google_api_403: …` string,
//   - `googleResult` to wrap a tool body so every failure is mapped consistently,
//   - base64url helpers used by Gmail MIME building,
//   - a `verify` helper so write tools can attach an automatic read-back.
//
// Production rule (Wave 0): no tool reports success without a read-back, and no
// error reaches the user as a stack trace.

import type { ConnectionCallResult } from '../../types';

export const GOOGLE_BASE = 'https://www.googleapis.com';
export const DOCS_BASE = 'https://docs.googleapis.com';

/** Typed Google API failure carrying the HTTP status and raw body for mapping. */
export class GoogleApiError extends Error {
  constructor(
    public readonly api: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`google_${api}_${status}`);
    this.name = 'GoogleApiError';
  }
}

/** JSON request against a Google API. Throws GoogleApiError on non-2xx. */
export async function googleApiFetch(
  api: string,
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new GoogleApiError(api, res.status, text);
  return text ? (JSON.parse(text) as unknown) : {};
}

/** Binary download (exports, attachments). Throws GoogleApiError on non-2xx. */
export async function googleDownloadBytes(api: string, url: string, token: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GoogleApiError(api, res.status, await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

const API_LABEL: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  sheets: 'Google Sheets',
  docs: 'Google Docs',
  drive: 'Google Drive',
  auth: 'Google bejelentkezés',
};

/** Translate a GoogleApiError (or any throw) into a user-facing, actionable result. */
export function mapGoogleError(e: unknown): ConnectionCallResult {
  if (!(e instanceof GoogleApiError)) {
    return { success: false, output: '', error: `google_unexpected_error: ${String(e)}` };
  }
  const label = API_LABEL[e.api] ?? e.api;
  const lower = e.body.toLowerCase();
  let message: string;
  let suggestedAction: string;
  let blocker: string;

  switch (e.status) {
    case 401:
      message = `A ${label} hozzáférési token lejárt vagy érvénytelen.`;
      suggestedAction = 'Kösd be újra a Google Workspace connectiont a Connections oldalon.';
      blocker = 'expired';
      break;
    case 403:
      if (lower.includes('has not been used') || lower.includes('accessnotconfigured') || lower.includes('service_disabled') || lower.includes('is disabled')) {
        message = `A ${label} API nincs engedélyezve a Google Cloud projektben.`;
        suggestedAction = `Engedélyezd a ${label} API-t a Google Cloud Console-ban, majd próbáld újra.`;
        blocker = 'api_not_enabled';
      } else if (lower.includes('insufficient') || lower.includes('scope')) {
        message = `A ${label} művelethez hiányzik egy OAuth scope.`;
        suggestedAction = 'Kösd be újra a connectiont, hogy a bővített jogosultságokat megadd.';
        blocker = 'insufficient_scope';
      } else {
        message = `A ${label} elutasította a kérést (nincs jogosultság ehhez az erőforráshoz).`;
        suggestedAction = 'Ellenőrizd, hogy a bekötött fiók hozzáfér-e ehhez az elemhez.';
        blocker = 'forbidden';
      }
      break;
    case 404:
      message = `A kért ${label} erőforrás nem található.`;
      suggestedAction = 'Ellenőrizd az azonosítót (id/range), vagy hogy az elem nem lett-e törölve.';
      blocker = 'not_found';
      break;
    case 429:
      message = `A ${label} API túl sok kérést jelzett (rate limit / kvóta).`;
      suggestedAction = 'Várj néhány másodpercet, majd próbáld újra; nagy mennyiségnél lassíts a hívásokon.';
      blocker = 'rate_limited';
      break;
    default:
      if (e.status >= 500) {
        message = `A ${label} szolgáltatás átmeneti hibát adott (${e.status}).`;
        suggestedAction = 'Próbáld újra kicsit később.';
        blocker = 'server_error';
      } else {
        message = `A ${label} API hibát adott (${e.status}).`;
        suggestedAction = 'Nézd meg a részleteket, és próbáld újra.';
        blocker = 'api_error';
      }
  }
  return {
    success: false,
    output: '',
    error: `${message} ${suggestedAction}`,
    details: { status: e.status, api: e.api, blocker, suggestedAction, raw: e.body.slice(0, 500) },
  };
}

/** Wrap a tool body so every throw is mapped to a clean, actionable result. */
export async function googleResult(fn: () => Promise<ConnectionCallResult>): Promise<ConnectionCallResult> {
  try {
    return await fn();
  } catch (e) {
    return mapGoogleError(e);
  }
}

// ── base64url helpers (Gmail MIME) ────────────────────────────────────────────

export function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64Standard(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** RFC 2047 encode a header value when it contains non-ASCII (e.g. Hungarian accents). */
export function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Standard(value)}?=`;
}
