import type { ConnectionManifest } from '../../types';
import { GOOGLE_WORKSPACE_SCOPES } from './auth';
import { googleWorkspaceTools } from './tools';

export const googleWorkspaceManifest: ConnectionManifest = {
  id: 'google-workspace',
  name: 'Google Workspace',
  description: 'API-first Google Drive, Sheets and Docs workflow. Uses OAuth access token when configured; mock mode is available for tests.',
  auth: {
    type: 'oauth',
    envVars: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_WORKSPACE_ACCESS_TOKEN',
      'GOOGLE_WORKSPACE_REFRESH_TOKEN',
      'GOOGLE_WORKSPACE_ACCOUNT_EMAIL',
    ],
    envVarGroups: [
      ['GOOGLE_WORKSPACE_ACCESS_TOKEN'],
      ['GOOGLE_WORKSPACE_REFRESH_TOKEN'],
    ],
    scopes: GOOGLE_WORKSPACE_SCOPES,
  },
  risk: 'external_write',
  tools: googleWorkspaceTools,
  skills: ['google-workspace', 'google-sheets', 'google-docs'],
};
