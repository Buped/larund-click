import type { ConnectionManifest } from '../../types';
import { githubTools } from './tools';

export const githubManifest: ConnectionManifest = {
  id: 'github',
  name: 'GitHub',
  description: 'Read repos, manage issues, create branches and open PRs.',
  auth: { type: 'api_key', envVars: ['GITHUB_TOKEN'], scopes: ['repo'] },
  tools: githubTools,
  skills: ['github-maintainer'],
  risk: 'external_write',
};
