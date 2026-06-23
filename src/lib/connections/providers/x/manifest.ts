import type { ConnectionManifest } from '../../types';
import { X_AUTH_GROUPS, X_ENV_VARS } from './env';
import { xTools } from './tools';

export const xManifest: ConnectionManifest = {
  id: 'x',
  name: 'X / Twitter',
  description: 'Search/read X through Larund app access, connect one or more X accounts, and post/delete/schedule with approval and UC billing.',
  auth: {
    type: 'oauth',
    envVars: X_ENV_VARS,
    envVarGroups: X_AUTH_GROUPS,
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
  },
  tools: xTools,
  risk: 'external_send',
};
