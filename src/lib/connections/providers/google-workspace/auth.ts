export interface GoogleAuthState {
  accessToken?: string;
  accountEmail?: string;
}

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
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
      handoff: 'Connect Google Workspace in Settings -> Connections, or ask for a local xlsx/docx fallback.',
      scopes: GOOGLE_WORKSPACE_SCOPES,
    },
  };
}
