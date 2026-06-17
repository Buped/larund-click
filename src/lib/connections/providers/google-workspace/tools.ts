import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { googleSheetsTools } from './sheets';
import { googleDocsTools } from './docs';
import { googleDriveTools } from './drive';
import { googleGmailTools } from './gmail';
import { googleCalendarTools } from './calendar';

export const googleWorkspaceTools: ConnectionToolDefinition[] = [
  {
    name: 'google.test_connection',
    description: 'Verify the Google Workspace OAuth token and return the account email.',
    risk: 'external_read',
    async run(_args, secrets) {
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const text = await res.text();
      if (!res.ok) return { success: false, output: '', error: `google_auth_${res.status}: ${text.slice(0, 300)}` };
      const data = text ? JSON.parse(text) as { email?: string; sub?: string } : {};
      return {
        success: true,
        output: `Connected to Google Workspace${data.email ? ` as ${data.email}` : ''}.`,
        details: { account: data.email, id: data.sub },
      };
    },
  },
  ...googleSheetsTools,
  ...googleDocsTools,
  ...googleDriveTools,
  ...googleGmailTools,
  ...googleCalendarTools,
];
