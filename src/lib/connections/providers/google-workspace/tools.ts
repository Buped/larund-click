import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { GOOGLE_BASE, DOCS_BASE, GoogleApiError } from './client';
import { googleSheetsTools } from './sheets';
import { googleDocsTools } from './docs';
import { googleDriveTools } from './drive';
import { googleGmailTools } from './gmail';
import { googleCalendarTools } from './calendar';

interface ServiceProbe {
  service: string;
  ok: boolean;
  detail: string;
}

/** Run a read-only GET; ok when 2xx. */
async function probeOk(service: string, url: string, token: string): Promise<ServiceProbe> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { service, ok: true, detail: 'elérhető' };
    const body = (await res.text()).toLowerCase();
    if (res.status === 403 && (body.includes('has not been used') || body.includes('disabled') || body.includes('accessnotconfigured'))) {
      return { service, ok: false, detail: 'API nincs engedélyezve a Google Cloud projektben' };
    }
    if (res.status === 401) return { service, ok: false, detail: 'token lejárt / érvénytelen' };
    if (res.status === 403) return { service, ok: false, detail: 'hiányzó scope vagy nincs jogosultság' };
    return { service, ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { service, ok: false, detail: String(e) };
  }
}

/**
 * Probe API *enablement* for services with no cheap "list" endpoint (Sheets, Docs)
 * by hitting an intentionally-invalid id: 404/400 ⇒ API is enabled (just not found),
 * 403 accessNotConfigured ⇒ API disabled.
 */
async function probeEnabled(service: string, url: string, token: string): Promise<ServiceProbe> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok || res.status === 404 || res.status === 400) return { service, ok: true, detail: 'API engedélyezve' };
    const body = (await res.text()).toLowerCase();
    if (res.status === 403 && (body.includes('has not been used') || body.includes('disabled') || body.includes('accessnotconfigured'))) {
      return { service, ok: false, detail: 'API nincs engedélyezve a Google Cloud projektben' };
    }
    if (res.status === 401) return { service, ok: false, detail: 'token lejárt / érvénytelen' };
    if (res.status === 403) return { service, ok: false, detail: 'hiányzó scope vagy nincs jogosultság' };
    return { service, ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { service, ok: false, detail: String(e) };
  }
}

export const googleWorkspaceTools: ConnectionToolDefinition[] = [
  {
    name: 'google.test_connection',
    description: 'Verify Google Workspace per sub-service (Account, Gmail, Calendar, Drive, Sheets, Docs) with read-only probes.',
    risk: 'external_read',
    async run(_args, secrets) {
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const token = auth.accessToken;

      // Account first: a hard failure here means every sub-service will fail.
      let account: string | undefined;
      try {
        const res = await fetch(`${GOOGLE_BASE}/oauth2/v3/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new GoogleApiError('auth', res.status, await res.text());
        account = ((await res.json()) as { email?: string }).email;
      } catch {
        return { success: false, output: '', error: 'A Google bejelentkezés nem érvényes — kösd be újra a connectiont.', details: { blocker: 'expired' } };
      }

      const probes = await Promise.all([
        probeOk('Gmail', `${GOOGLE_BASE}/gmail/v1/users/me/profile`, token),
        probeOk('Calendar', `${GOOGLE_BASE}/calendar/v3/users/me/calendarList?maxResults=1`, token),
        probeOk('Drive', `${GOOGLE_BASE}/drive/v3/files?pageSize=1`, token),
        probeEnabled('Sheets', `${GOOGLE_BASE}/v4/spreadsheets/larund-probe-invalid`, token),
        probeEnabled('Docs', `${DOCS_BASE}/v1/documents/larund-probe-invalid`, token),
      ]);

      const allOk = probes.every((p) => p.ok);
      const summary = probes.map((p) => `${p.ok ? '🟢' : '🔴'} ${p.service}: ${p.detail}`).join('\n');
      return {
        success: allOk,
        output: `Google Workspace${account ? ` (${account})` : ''}\n${summary}`,
        details: { account, services: probes, allOk },
      };
    },
  },
  ...googleSheetsTools,
  ...googleDocsTools,
  ...googleDriveTools,
  ...googleGmailTools,
  ...googleCalendarTools,
];
