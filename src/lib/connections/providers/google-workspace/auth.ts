export interface GoogleAuthState {
  accessToken?: string;
  accountEmail?: string;
}

// Single source of truth for the scopes requested at Connect time AND advertised by
// the manifest. `oauth/flow.ts` imports this so the two can never drift again.
//
// NOTE on Google verification: `gmail.modify`, `calendar` and full `drive` are
// "restricted"/"sensitive" scopes. They work immediately for the pilot's
// unverified-app flow with explicitly added test users (up to 100). For a public
// production release Google requires an OAuth verification / CASA security
// assessment. Narrow these (e.g. drive.file, gmail.compose) only if you accept the
// matching feature loss (drive.file cannot see the user's existing files).
export const GOOGLE_WORKSPACE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.modify', // search + read + draft + send
  'https://www.googleapis.com/auth/calendar', // list + free/busy + create
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations.readonly',
  'https://www.googleapis.com/auth/drive', // search must see the user's existing files
];

export function googleAuthFromSecrets(secrets: Record<string, string>): GoogleAuthState {
  return {
    accessToken: secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN,
    accountEmail: secrets.GOOGLE_WORKSPACE_ACCOUNT_EMAIL,
  };
}

export function missingGoogleAuth(): { success: false; output: string; error: string; details: Record<string, unknown> } {
  return {
    success: false,
    output: '',
    error: 'missing_google_workspace_auth',
    details: {
      handoff: 'Kösd be a Google Workspace-t a Connections oldalon (Gmail, Naptár, Sheets, Docs, Drive), vagy kérj lokális xlsx/docx fallbacket.',
      scopes: GOOGLE_WORKSPACE_SCOPES,
    },
  };
}
