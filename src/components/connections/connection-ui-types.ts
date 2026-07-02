import type { ToolRisk } from '../../lib/control-system/types';
import type { ResolvedCatalogProvider, RuntimeConnectionState } from '../../lib/connections/catalog';
import type { ConnectionProvider } from '../../lib/connections/hub/types';
import type { McpProviderState } from '../../lib/mcp/connect-provider';

export type ConnectionsHubVariant = 'page' | 'settings';

export interface ConnectionsHubProps {
  userId: string;
  projectId?: string | null;
  isAdmin: boolean;
  variant?: ConnectionsHubVariant;
  initialFilter?: string;
  compact?: boolean;
  showHeader?: boolean;
  showSearch?: boolean;
  showFilters?: boolean;
  showUpcomingToggle?: boolean;
  onConnectionChanged?: () => void;
}

export type ConnectionFilter =
  | 'All'
  | 'Connected'
  | 'Needs setup'
  | 'Native API'
  | 'MCP'
  | 'MCP available'
  | 'Productivity'
  | 'Marketing'
  | 'Development'
  | 'Communication'
  | 'Data';

export const PAGE_FILTERS: readonly ConnectionFilter[] = [
  'All',
  'Connected',
  'Needs setup',
  'Native API',
  'MCP available',
  'Productivity',
  'Marketing',
  'Development',
  'Communication',
  'Data',
];

export const SETTINGS_FILTERS: readonly ConnectionFilter[] = [
  'All',
  'Connected',
  'Needs setup',
  'Native API',
  'MCP',
];

export const RUNTIME_LABEL: Record<RuntimeConnectionState, { text: string; color: string }> = {
  connected: { text: 'Connected', color: 'var(--success)' },
  ready_to_connect: { text: 'Ready to connect', color: 'var(--accent)' },
  api_key_required: { text: 'Add API key', color: 'var(--accent)' },
  developer_setup_missing: { text: 'Developer setup missing', color: 'var(--warning)' },
  needs_reconnect: { text: 'Needs reconnect', color: 'var(--warning)' },
  dev_shortcut_active: { text: 'Dev shortcut active', color: '#7C3AED' },
  mcp_available: { text: 'MCP available', color: 'var(--accent)' },
  coming_soon: { text: 'Coming soon', color: 'var(--text-hint)' },
};

export const STATE_RANK: Record<RuntimeConnectionState, number> = {
  connected: 0,
  dev_shortcut_active: 0,
  ready_to_connect: 1,
  api_key_required: 1,
  needs_reconnect: 1,
  mcp_available: 2,
  developer_setup_missing: 3,
  coming_soon: 4,
};

export const NEEDS_SETUP: RuntimeConnectionState[] = [
  'ready_to_connect',
  'api_key_required',
  'developer_setup_missing',
  'needs_reconnect',
];

export const RISK_GROUPS: Array<{ label: string; risks: ToolRisk[] }> = [
  { label: 'Read', risks: ['read_only', 'external_read'] },
  { label: 'Write', risks: ['local_write', 'external_write'] },
  { label: 'Send / publish', risks: ['external_send'] },
  { label: 'Destructive', risks: ['destructive', 'process_exec'] },
];

export type ToolPolicy = 'allow' | 'ask' | 'block';

export function isLiveConnection(state: RuntimeConnectionState): boolean {
  return state === 'connected' || state === 'dev_shortcut_active';
}

export function actionLabel(state: RuntimeConnectionState): string {
  if (state === 'connected' || state === 'dev_shortcut_active') return 'Manage';
  if (state === 'needs_reconnect') return 'Reconnect';
  if (state === 'developer_setup_missing') return 'Developer setup';
  if (state === 'api_key_required') return 'Add API key';
  return 'Connect';
}

export function statusExplanation(
  provider: ResolvedCatalogProvider,
  requiredEnv: string[],
  isDeveloperSetupVisible: boolean,
): string {
  switch (provider.runtime) {
    case 'connected':
      return 'Larund can use approved tools from this provider.';
    case 'ready_to_connect':
      return 'Larund is ready. Sign in with your account to let the AI use this app.';
    case 'api_key_required':
      return 'Paste your API key or personal access token to connect this app.';
    case 'developer_setup_missing':
      return isDeveloperSetupVisible && requiredEnv.length
        ? `Larund developer setup is missing. Set ${requiredEnv.join(', ')}.`
        : 'This connection is not available yet. Ask the Larund admin or developer to enable it.';
    case 'needs_reconnect':
      return 'Your token expired or was revoked. Reconnect to continue using this app.';
    case 'dev_shortcut_active':
      return 'Developer shortcut active. This is for local development, not a production user connection.';
    case 'mcp_available':
      return 'Connect through an MCP server. Larund will inspect tools before using them.';
    case 'coming_soon':
      return 'Native tools are not implemented yet. No fake capability.';
    default:
      return provider.description;
  }
}

export function defaultMcpUrl(provider: ResolvedCatalogProvider): string | undefined {
  for (const impl of provider.implementations) {
    if (impl.kind === 'remote_mcp' && impl.defaultServerUrl) return impl.defaultServerUrl;
  }
  return undefined;
}

export function mcpStateToRuntime(state: McpProviderState | string): RuntimeConnectionState | undefined {
  switch (state) {
    case 'ready':
    case 'connected':
      return 'connected';
    case 'review_tools':
      return 'mcp_available';
    case 'auth_required':
    case 'error':
      return 'needs_reconnect';
    default:
      return undefined;
  }
}

export function toolPolicyKey(
  userId: string,
  projectId: string | null | undefined,
  providerId: string,
  tool: string,
): string {
  return `conn_tool_policy:${userId}:${projectId ?? 'personal'}:${providerId}:${tool}`;
}

export function defaultToolPolicy(risk: ToolRisk): ToolPolicy {
  return risk === 'external_send' || risk === 'destructive' || risk === 'process_exec' ? 'ask' : 'allow';
}

export function getToolPolicy(
  userId: string,
  projectId: string | null | undefined,
  providerId: string,
  tool: string,
  risk: ToolRisk,
): ToolPolicy {
  const stored = localStorage.getItem(toolPolicyKey(userId, projectId, providerId, tool));
  if (stored === 'allow' || stored === 'ask' || stored === 'block') return stored;
  return defaultToolPolicy(risk);
}

export function setToolPolicy(
  userId: string,
  projectId: string | null | undefined,
  providerId: string,
  tool: string,
  policy: ToolPolicy,
): void {
  localStorage.setItem(toolPolicyKey(userId, projectId, providerId, tool), policy);
}

export interface CredentialFieldDef {
  name: string;
  label: string;
  placeholder: string;
  secret: boolean;
}

const FIELD_COPY: Record<string, Omit<CredentialFieldDef, 'name'>> = {
  GITHUB_TOKEN: { label: 'GitHub personal access token', placeholder: 'ghp_...', secret: true },
  NOTION_TOKEN: { label: 'Notion integration token', placeholder: 'secret_...', secret: true },
  HUBSPOT_PRIVATE_APP_TOKEN: { label: 'Private app token', placeholder: 'pat-...', secret: true },
  BILLINGO_API_KEY: { label: 'Billingo API key', placeholder: 'API key', secret: true },
  WOOCOMMERCE_STORE_URL: { label: 'Store URL', placeholder: 'https://store.example.com', secret: false },
  WOOCOMMERCE_CONSUMER_KEY: { label: 'Consumer key', placeholder: 'ck_...', secret: true },
  WOOCOMMERCE_CONSUMER_SECRET: { label: 'Consumer secret', placeholder: 'cs_...', secret: true },
  WORDPRESS_SITE_URL: { label: 'Site URL', placeholder: 'https://site.example.com', secret: false },
  WORDPRESS_USERNAME: { label: 'Username', placeholder: 'admin@example.com', secret: false },
  WORDPRESS_APP_PASSWORD: { label: 'Application password', placeholder: 'xxxx xxxx xxxx xxxx', secret: true },
  SUPABASE_ACCESS_TOKEN: { label: 'Supabase access token', placeholder: 'sbp_...', secret: true },
  SUPABASE_URL: { label: 'Supabase URL', placeholder: 'https://project.supabase.co', secret: false },
  SUPABASE_SERVICE_ROLE_KEY: { label: 'Service role key', placeholder: 'eyJ...', secret: true },
  VERCEL_TOKEN: { label: 'Vercel token', placeholder: 'vercel token', secret: true },
  STRIPE_SECRET_KEY: { label: 'Stripe secret key', placeholder: 'sk_...', secret: true },
};

function fallbackField(field: string): CredentialFieldDef {
  return {
    name: field,
    label: field.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    placeholder: field.includes('URL') ? 'https://...' : 'Paste value',
    secret: !/URL|DOMAIN|USERNAME|EMAIL|SITE/i.test(field),
  };
}

export function credentialFieldsForProvider(
  providerId: string,
  hubProvider?: ConnectionProvider,
): CredentialFieldDef[] {
  const fields = hubProvider?.envVars ?? [];
  const selected = fields.length ? fields : [`${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`];
  return selected.map((name) => ({ name, ...(FIELD_COPY[name] ?? fallbackField(name)) }));
}
