import type { ConnectionRegistry, ConnectionCallResult } from '../tools/types';
import type { ConnectionInfo, ConnectionManifest, ConnectionStatus } from './types';
import { getSecrets, hasAllSecrets } from './secrets';
import { githubManifest } from './providers/github/manifest';
import { notionManifest } from './providers/notion/manifest';
import { googleWorkspaceManifest } from './providers/google-workspace/manifest';
import { slackManifest } from './providers/slack/manifest';
import { hubspotManifest, airtableManifest, wordpressManifest } from './providers/extra-scaffolds';

export const ALL_MANIFESTS: ConnectionManifest[] = [
  githubManifest,
  notionManifest,
  googleWorkspaceManifest,
  slackManifest,
  hubspotManifest,
  airtableManifest,
  wordpressManifest,
];

export function connectionStatus(m: ConnectionManifest): ConnectionStatus {
  if (m.scaffold) return 'scaffold';
  if (m.auth.type === 'none') return 'configured';
  return hasAllSecrets(m.auth.envVars ?? []) ? 'configured' : 'missing_auth';
}

export function listConnections(): ConnectionInfo[] {
  return ALL_MANIFESTS.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    status: connectionStatus(m),
    authType: m.auth.type,
    scopes: m.auth.scopes ?? [],
    tools: m.tools.map((t) => t.name),
  }));
}

/**
 * Build a ConnectionRegistry. `call(connection, tool, args)` resolves the
 * provider + tool, checks configuration, then runs it with resolved secrets.
 */
export function createConnectionRegistry(_userId = ''): ConnectionRegistry {
  const byId = new Map(ALL_MANIFESTS.map((m) => [m.id, m]));

  return {
    isConfigured(connection: string): boolean {
      const m = byId.get(connection);
      return m ? connectionStatus(m) === 'configured' : false;
    },
    async call(connection: string, tool: string, args: Record<string, unknown>): Promise<ConnectionCallResult> {
      const m = byId.get(connection);
      if (!m) return { success: false, output: '', error: `unknown_connection:${connection}` };
      if (m.scaffold) return { success: false, output: '', error: `connection_scaffold:${connection}` };

      // Accept both "tool" and "connection.tool" forms.
      const fq = tool.includes('.') ? tool : `${connection}.${tool}`;
      const def = m.tools.find((t) => t.name === fq || t.name === tool);
      if (!def) return { success: false, output: '', error: `unknown_tool:${tool}` };

      // Providers fall back to mock output when their secret is missing, so we
      // resolve whatever is configured and let the tool decide.
      const secrets = getSecrets(m.auth.envVars ?? []);
      try {
        return await def.run(args, secrets);
      } catch (e) {
        return { success: false, output: '', error: `connection_error: ${String(e)}` };
      }
    },
  };
}
