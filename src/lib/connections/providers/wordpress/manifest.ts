import type { ConnectionManifest } from '../../types';
import { wordpressTools } from './tools';

// WordPress: a real, runnable connection (no longer a scaffold). Auth is a per-site
// application password stored in the secure user secret store (see userCredentials.ts),
// surfaced to tools at call time via resolveRuntimeCredentials. Reads run
// automatically; writes ask; publish is external_send (always ask).
export const wordpressManifest: ConnectionManifest = {
  id: 'wordpress',
  name: 'WordPress',
  description: 'Posts, pages, media and taxonomy via the WordPress REST API (application password).',
  auth: { type: 'api_key', envVars: ['WORDPRESS_SITE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'] },
  risk: 'external_write',
  tools: wordpressTools,
};
