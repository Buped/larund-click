import type { ConnectionRegistry, ConnectionCallResult } from '../tools/types';
import type { ToolRisk } from '../control-system/types';
import type { ConnectionInfo, ConnectionManifest, ConnectionStatus } from './types';
import { missingAuth, mockConnectionsAllowed } from './mock-guard';
import { isDeveloperSetupReady, devPatShortcutsEnabled, getProviderSecret } from './env/resolve';
import { envSchemaForProvider } from './env/schema';
import { getConnectedAccount, DEFAULT_CONTEXT, type ConnectionContext } from './connectedAccounts';
import { resolveRuntimeCredentials } from './runtimeCredentials';
import { githubManifest } from './providers/github/manifest';
import { notionManifest } from './providers/notion/manifest';
import { googleWorkspaceManifest } from './providers/google-workspace/manifest';
import { slackManifest } from './providers/slack/manifest';
import { xManifest } from './providers/x/manifest';
import { wordpressManifest } from './providers/wordpress/manifest';
import { hubspotManifest, airtableManifest, moreScaffoldManifests } from './providers/extra-scaffolds';

export const ALL_MANIFESTS: ConnectionManifest[] = [
  githubManifest,
  notionManifest,
  googleWorkspaceManifest,
  xManifest,
  slackManifest,
  hubspotManifest,
  airtableManifest,
  wordpressManifest,
  ...moreScaffoldManifests,
];

// Authoritative per-tool risk, declared by each provider manifest. The risk policy
// consults this so approval gating reflects what a tool actually does (e.g.
// set_featured_media is a write, publish_* is external_send) rather than guessing from
// the tool name. Both the fully-qualified and short tool names are indexed.
const TOOL_RISK_BY_NAME = new Map<string, ToolRisk>();
for (const m of ALL_MANIFESTS) {
  for (const t of m.tools) {
    TOOL_RISK_BY_NAME.set(t.name, t.risk);
    const short = t.name.includes('.') ? t.name.split('.').slice(1).join('.') : t.name;
    if (!TOOL_RISK_BY_NAME.has(short)) TOOL_RISK_BY_NAME.set(short, t.risk);
  }
}

/** The risk a provider manifest declares for a tool, if known. */
export function connectionToolDeclaredRisk(tool: string): ToolRisk | undefined {
  return TOOL_RISK_BY_NAME.get(tool);
}

/**
 * Per-user runtime state for a provider. Distinguishes app-level developer setup
 * from a user actually being connected.
 */
export type ProviderRuntimeState =
  | 'connected'
  | 'ready_to_connect'
  | 'api_key_required'
  | 'developer_setup_missing'
  | 'needs_reconnect'
  | 'dev_shortcut_active'
  | 'mcp_available'
  | 'scaffold';

export function providerRuntimeState(providerId: string, ctx: ConnectionContext = DEFAULT_CONTEXT): ProviderRuntimeState {
  const schema = envSchemaForProvider(providerId);
  if (schema.authMode === 'mcp_url') {
    return isDeveloperSetupReady(providerId) ? 'mcp_available' : 'developer_setup_missing';
  }
  const account = getConnectedAccount(providerId, ctx);
  if (account) return account.status === 'connected' ? 'connected' : 'needs_reconnect';
  if (devPatShortcutsEnabled() && schema.devShortcut.some((key) => Boolean(getProviderSecret(providerId, key)))) {
    return 'dev_shortcut_active';
  }
  if (schema.appRequired.length > 0 && !isDeveloperSetupReady(providerId)) return 'developer_setup_missing';
  // API-key / PAT providers need the user's own key, not an OAuth Connect.
  if (schema.authMode === 'api_key_user_entered' || schema.authMode === 'pat_user_entered') return 'api_key_required';
  return 'ready_to_connect';
}

/**
 * Coarse status for legacy callers. `configured` means the agent can call tools
 * now (a user is connected, a dev shortcut is active, or an MCP server is set) —
 * NOT merely that app credentials exist.
 */
export function connectionStatus(m: ConnectionManifest, ctx: ConnectionContext = DEFAULT_CONTEXT): ConnectionStatus {
  if (m.scaffold) return 'scaffold';
  if (m.auth.type === 'none') return 'configured';
  const state = providerRuntimeState(m.id, ctx);
  return state === 'connected' || state === 'dev_shortcut_active' || state === 'mcp_available' ? 'configured' : 'missing_auth';
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
export function createConnectionRegistry(userId = ''): ConnectionRegistry {
  const byId = new Map(ALL_MANIFESTS.map((m) => [m.id, m]));
  const ctx: ConnectionContext = { userId: userId || DEFAULT_CONTEXT.userId };

  return {
    isConfigured(connection: string): boolean {
      const m = byId.get(connection);
      return m ? connectionStatus(m, ctx) === 'configured' : false;
    },
    async call(connection: string, tool: string, args: Record<string, unknown>): Promise<ConnectionCallResult> {
      const m = byId.get(connection);
      if (!m) return { success: false, output: '', error: `unknown_connection:${connection}` };
      if (m.scaffold) return { success: false, output: '', error: `connection_scaffold:${connection}` };

      // Accept both "tool" and "connection.tool" forms.
      const fq = tool.includes('.') ? tool : `${connection}.${tool}`;
      const def = m.tools.find((t) => t.name === fq || t.name === tool);
      if (!def) return { success: false, output: '', error: `unknown_tool:${tool}` };

      // Resolve user credentials: connected account → dev shortcut → mcp → blocker.
      // The app-level client secret is NEVER used as a user token here.
      const resolved = await resolveRuntimeCredentials(m.id, ctx);
      if (!resolved.ok && !mockConnectionsAllowed()) {
        return missingAuth(m.name, fq, resolved.message ?? 'Connect your account first.', resolved.blocker);
      }
      try {
        return await def.run(args, resolved.secrets);
      } catch (e) {
        return { success: false, output: '', error: `connection_error: ${String(e)}` };
      }
    },
  };
}
