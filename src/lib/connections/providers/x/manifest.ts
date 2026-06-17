import type { ConnectionManifest } from '../../types';
import { X_AUTH_GROUPS, X_ENV_VARS } from './env';
import { xTools } from './tools';

export const xManifest: ConnectionManifest = {
  id: 'x',
  name: 'X / Twitter',
  description: 'Search X posts and users, analyze topics, and create/reply/delete posts with approval.',
  auth: {
    type: 'oauth',
    envVars: X_ENV_VARS,
    envVarGroups: X_AUTH_GROUPS,
    scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
  },
  tools: xTools,
  risk: 'external_send',
};
