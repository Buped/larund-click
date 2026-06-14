import type { ConnectionManifest } from '../../types';
import { GOOGLE_WORKSPACE_SCOPES } from './auth';
import { googleWorkspaceTools } from './tools';

export const googleWorkspaceManifest: ConnectionManifest = {
  id: 'google-workspace',
  name: 'Google Workspace',
  description: 'API-first Google Drive, Sheets and Docs workflow. Uses OAuth access token when configured; mock mode is available for tests.',
  auth: {
    type: 'oauth',
    envVars: ['GOOGLE_WORKSPACE_ACCESS_TOKEN'],
    scopes: GOOGLE_WORKSPACE_SCOPES,
  },
  risk: 'external_write',
  tools: googleWorkspaceTools,
  skills: ['google-workspace', 'google-sheets', 'google-docs'],
};
