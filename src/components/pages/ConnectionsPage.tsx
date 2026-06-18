// Connections — a polished app/connector directory backed by the connection
// catalog (40+ providers) reconciled with live runtime state. Card status now
// distinguishes the two credential layers (see
// docs/connections/credentials-architecture.md):
//   • Developer setup missing — app-level OAuth creds not configured in .env.
//   • Ready to connect        — app creds exist; the user can click Connect.
//   • Connected               — this user has a connected account stored.
//   • Needs reconnect         — the user's token expired/was revoked.
//   • Dev shortcut active      — a DEV_* personal token is in use (Developer Mode).
// Tool execution is unchanged; we never fake capability.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { getProvider } from '../../lib/connections/hub/status';
import type { ConnectionProvider } from '../../lib/connections/hub/types';
import type { ToolRisk } from '../../lib/control-system/types';
import { listCatalogProviders } from '../../lib/connections/catalog';
import type { ResolvedCatalogProvider, RuntimeConnectionState } from '../../lib/connections/catalog';
import { createConnectionRegistry } from '../../lib/connections/registry';
import { setPersistentSecret } from '../../lib/connections/secrets';
import { envSchemaForProvider } from '../../lib/connections/env/schema';
import { getProviderSecretSource, isDeveloperSetupReady } from '../../lib/connections/env/resolve';
import { getProviderAuthConfig } from '../../lib/connections/providerAuth';
import {
  createConnectedAccount, listConnectedAccountsForProvider, disconnectConnectedAccount,
  type ConnectedAccount,
} from '../../lib/connections/connectedAccounts';
import { beginOAuthConnect } from '../../lib/connections/oauth/connect';
import { redirectUriFor } from '../../lib/connections/oauth/flow';
import { HiggsfieldDetail } from '../connections/HiggsfieldDetail';
import { higgsfieldConnectionState } from '../../lib/mcp/higgsfield/connect';
import {
  connectMcpProvider, mcpProviderState, setMcpProviderUrl, disconnectMcpProvider,
  type McpProviderState,
} from '../../lib/mcp/connect-provider';
import {
  PageFrame, PageHeader, Empty, SearchInput, Badge,
  card, btn, ghostBtn, input, labelStyle, getActiveWorkspaceId,
} from './ui';

const FILTERS = ['All', 'Connected', 'Needs setup', 'Native API', 'MCP available', 'Productivity', 'Marketing', 'Development', 'Communication', 'Data'] as const;
type Filter = typeof FILTERS[number];

const RUNTIME_LABEL: Record<RuntimeConnectionState, { text: string; color: string }> = {
  connected: { text: 'Connected', color: 'var(--success)' },
  ready_to_connect: { text: 'Ready to connect', color: 'var(--accent)' },
  api_key_required: { text: 'Add API key', color: 'var(--accent)' },
  developer_setup_missing: { text: 'Developer setup missing', color: 'var(--warning)' },
  needs_reconnect: { text: 'Needs reconnect', color: 'var(--warning)' },
  dev_shortcut_active: { text: 'Dev shortcut active', color: '#7C3AED' },
  mcp_available: { text: 'MCP available', color: 'var(--accent)' },
  coming_soon: { text: 'Coming soon', color: 'var(--text-hint)' },
};

// Connection-state ranking: connected float to the top, then actionable, then
// blocked/coming-soon. Used to sort the grid so the user's live connections lead.
const STATE_RANK: Record<RuntimeConnectionState, number> = {
  connected: 0,
  dev_shortcut_active: 0,
  ready_to_connect: 1,
  api_key_required: 1,
  needs_reconnect: 1,
  mcp_available: 2,
  developer_setup_missing: 3,
  coming_soon: 4,
};

/** Whether a card represents a live, working connection (full opacity). */
function isLiveConnection(s: RuntimeConnectionState): boolean {
  return s === 'connected' || s === 'dev_shortcut_active';
}

/** Default remote MCP URL declared by a provider's implementations, if any. */
function defaultMcpUrl(p: ResolvedCatalogProvider): string | undefined {
  for (const impl of p.implementations) {
    if (impl.kind === 'remote_mcp' && impl.defaultServerUrl) return impl.defaultServerUrl;
  }
  return undefined;
}

/** Map a live MCP/CLI server state onto the catalog card runtime state. */
function mcpStateToRuntime(s: McpProviderState | string): RuntimeConnectionState | undefined {
  switch (s) {
    case 'ready':
    case 'connected': return 'connected';
    case 'review_tools': return 'mcp_available';
    case 'auth_required':
    case 'error': return 'needs_reconnect';
    default: return undefined; // not_configured / ready_to_inspect → keep catalog base
  }
}

const RISK_GROUPS: Array<{ label: string; risks: ToolRisk[] }> = [
  { label: 'Read', risks: ['read_only', 'external_read'] },
  { label: 'Write', risks: ['local_write', 'external_write'] },
  { label: 'Send / publish', risks: ['external_send'] },
  { label: 'Destructive', risks: ['destructive', 'process_exec'] },
];

type ToolPolicy = 'allow' | 'ask' | 'block';
function policyKey(provider: string, tool: string) { return `conn_tool_policy:${provider}:${tool}`; }
function getPolicy(provider: string, tool: string, risk: ToolRisk): ToolPolicy {
  const stored = localStorage.getItem(policyKey(provider, tool));
  if (stored === 'allow' || stored === 'ask' || stored === 'block') return stored;
  return risk === 'external_send' || risk === 'destructive' || risk === 'process_exec' ? 'ask' : 'allow';
}

function ImplBadges({ p }: { p: ResolvedCatalogProvider }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {p.supportsNativeApi && <Badge text="Native API" color="var(--accent)" />}
      {p.supportsMcp && <Badge text="MCP available" color="#7C3AED" />}
    </div>
  );
}

// ── One-click MCP connect (generic, reused by any provider with a remote MCP) ──

const MCP_STATE_LABEL: Record<McpProviderState, { text: string; color: string }> = {
  not_configured: { text: 'Add MCP URL', color: 'var(--text-hint)' },
  ready_to_inspect: { text: 'Ready to inspect', color: 'var(--accent)' },
  auth_required: { text: 'Sign in required', color: 'var(--warning)' },
  connected: { text: 'Connected', color: 'var(--success)' },
  review_tools: { text: 'Review tools', color: 'var(--warning)' },
  ready: { text: 'Ready to use', color: 'var(--success)' },
  error: { text: 'Error', color: 'var(--danger)' },
};

function McpConnectCard({ providerId, name, defaultUrl, onChanged }: { providerId: string; name: string; defaultUrl?: string; onChanged: () => void }) {
  const ctx = { userId: 'local', workspaceId: getActiveWorkspaceId() };
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [state, setState] = useState<McpProviderState>('not_configured');
  const [serverId, setServerId] = useState<string | undefined>();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function refresh() {
    const s = await mcpProviderState(providerId, ctx);
    setState(s.state); setServerId(s.server?.id);
    if (s.server?.url && !url) setUrl(s.server.url);
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, []);

  async function connect() {
    if (!url.trim()) { setMsg('Enter the MCP server URL to connect.'); return; }
    setBusy('connect'); setMsg('');
    try {
      const s = await connectMcpProvider(providerId, name, url, ctx);
      setState(s.state); setServerId(s.server?.id); setMsg(s.message); onChanged();
    } catch (e) {
      setMsg(`Connect failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally { setBusy(''); }
  }

  const st = MCP_STATE_LABEL[state];
  const hasDefault = Boolean(defaultUrl);

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Connect via MCP server</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
        {hasDefault
          ? `One click connects ${name} through its hosted MCP server. Larund inspects the tools before any run.`
          : `Paste a ${name} MCP server URL. Larund inspects the tools before any run.`}
      </div>
      <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={connect}>
          {busy === 'connect' ? 'Connecting…' : state === 'connected' || state === 'ready' ? 'Reconnect & inspect' : 'Connect & inspect'}
        </button>
        {!hasDefault && (
          <button style={ghostBtn} disabled={!!busy || !url.trim()} onClick={async () => { await setMcpProviderUrl(providerId, name, url, ctx); await refresh(); setMsg('MCP URL saved.'); }}>Save URL</button>
        )}
        {serverId && (state === 'connected' || state === 'ready' || state === 'review_tools') && (
          <button style={ghostBtn} disabled={!!busy} onClick={async () => { await disconnectMcpProvider(serverId); await refresh(); setMsg('Disconnected.'); onChanged(); }}>Disconnect</button>
        )}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="dot" style={{ background: st.color }} /><span style={{ color: st.color, fontWeight: 600 }}>{st.text}</span>
        {msg && <span style={{ color: 'var(--text-muted)' }}>· {msg}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>Only connect MCP servers you trust. Discovered tools start unapproved and must be reviewed before use.</div>
    </div>
  );
}

// ── Setup modal: developer setup (app creds) + user connection ─────────────────

function SetupModal({ providerId, provider, name, onClose, onSaved }: { providerId: string; provider: ResolvedCatalogProvider; name: string; onClose: () => void; onSaved: () => void }) {
  const schema = envSchemaForProvider(providerId);
  const auth = getProviderAuthConfig(providerId);
  const devReady = isDeveloperSetupReady(providerId);
  const devMode = (() => { try { return localStorage.getItem('developer_mode') === 'true'; } catch { return false; } })();
  const isOAuth = auth.supportsOAuth;
  const isUserKey = auth.supportsUserApiKey;

  const [appValues, setAppValues] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [showDevSetup, setShowDevSetup] = useState(!devReady);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');
  const accounts = listConnectedAccountsForProvider(providerId);

  async function saveAppCreds() {
    const entries = Object.entries(appValues).filter(([, v]) => v.trim());
    for (const [k, v] of entries) await setPersistentSecret(k, v.trim());
    setStatus(entries.length ? `Saved ${entries.length} developer credential${entries.length === 1 ? '' : 's'}.` : 'No new values entered.');
    onSaved();
  }

  // One-click OAuth: opens the system browser, captures the loopback redirect,
  // exchanges the code, and stores the ConnectedAccount.
  async function connectOAuth() {
    setConnecting(true);
    setStatus('Opening your browser to sign in…');
    try {
      const account = await beginOAuthConnect(providerId, { userId: 'local' }, { accountLabel: label.trim() || undefined });
      setLabel('');
      setStatus(`Connected ${account.accountLabel}. You can close this.`);
      onSaved();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setStatus(
        msg.includes('oauth_loopback_unavailable') ? 'Connecting requires the Larund desktop app.'
        : msg.includes('oauth_cancelled') ? 'Sign-in was cancelled or timed out.'
        : msg.includes('oauth_state_mismatch') ? 'Security check failed (state mismatch). Please try again.'
        : `Connect failed: ${msg}`,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function connectApiKey() {
    if (!apiKey.trim()) { setStatus('Enter your API key to connect.'); return; }
    await createConnectedAccount({
      ctx: { userId: 'local' },
      providerId,
      accountLabel: label.trim() || `${name} account`,
      authType: auth.authMode === 'pat_user_entered' ? 'pat' : 'api_key',
      scopes: auth.scopes.map((s) => s.scope),
      tokens: { api_key: apiKey.trim() },
    });
    setApiKey(''); setLabel('');
    setStatus('Connected. Your key is stored encrypted on this device, never in .env.');
    onSaved();
  }

  async function disconnect(id: string) {
    await disconnectConnectedAccount(id);
    setStatus('Account disconnected.');
    onSaved();
  }

  async function test(account: ConnectedAccount) {
    const hub = getProvider(providerId);
    const testTool = hub?.tools.find((t) => t.name.endsWith('.test_connection'));
    if (!testTool) { setStatus('No provider-specific test is implemented yet.'); return; }
    const result = await createConnectionRegistry().call(providerId, testTool.name, {});
    setStatus(result.success ? result.output || `Connection test passed for ${account.accountLabel}.` : `Test failed: ${result.error ?? 'unknown error'}`);
  }

  const appKeys = [...auth.appCredentials.requiredEnv, ...auth.appCredentials.optionalEnv];
  const showDevCard = appKeys.length > 0 && (devMode || !devReady);

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 520, maxHeight: '86vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <BrandIcon providerId={providerId} />
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>Connect {name}</div><div style={{ fontSize: 12, color: 'var(--text-hint)' }}>{isOAuth ? 'Sign in with your account' : isUserKey ? 'Add your API key' : auth.authMode.replace(/_/g, ' ')}</div></div>
        </div>

        {/* Connected accounts */}
        {accounts.length > 0 && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Connected accounts</div>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{a.accountLabel}</div>
                  <div style={{ fontSize: 11, color: a.status === 'connected' ? 'var(--success)' : 'var(--warning)' }}>{a.status}{a.externalAccountEmail ? ` · ${a.externalAccountEmail}` : ''}</div>
                </div>
                <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => test(a)}>Test</button>
                <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => disconnect(a.id)}>Disconnect</button>
              </div>
            ))}
          </div>
        )}

        {/* Primary: one-click connection */}
        <div style={card}>
          {isOAuth ? (
            !devReady ? (
              <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>
                {name} isn’t available to connect yet — the Larund developer setup is missing.
                {devMode && <> Set {auth.appCredentials.requiredEnv.join(', ')} below.</>}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                  Click connect, sign in to {name} in your browser, and you’ll be brought right back — connected.
                </div>
                <input style={{ ...input, marginBottom: 8 }} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label this account (optional, e.g. work)" />
                <button style={{ ...btn, width: '100%', justifyContent: 'center', opacity: connecting ? 0.6 : 1 }} disabled={connecting} onClick={connectOAuth}>
                  {connecting ? 'Waiting for sign-in…' : accounts.length ? `Connect another ${name} account` : `Connect ${name}`}
                </button>
              </>
            )
          ) : isUserKey ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                {name} has no OAuth login — paste your API key. It’s stored encrypted on this device, never in .env.
              </div>
              <input style={input} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label this account (optional)" />
              <input style={{ ...input, marginTop: 6 }} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" />
              <button style={{ ...btn, marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={connectApiKey}>Connect</button>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{provider.supportsMcp ? 'Connect this one via its MCP server below.' : 'This connection is set up from the MCP page.'}</div>
          )}
        </div>

        {/* One-click MCP connect for any provider that supports a remote MCP server */}
        {provider.supportsMcp && (
          <McpConnectCard providerId={provider.id} name={provider.name} defaultUrl={defaultMcpUrl(provider)} onChanged={onSaved} />
        )}

        {/* Developer setup (app-level OAuth creds) — only when missing or in Developer Mode */}
        {showDevCard && (
          <div style={{ ...card, marginTop: 12, borderColor: devReady ? 'var(--border)' : 'var(--warning)' }}>
            <button style={{ ...ghostBtn, marginBottom: showDevSetup ? 8 : 0 }} onClick={() => setShowDevSetup((v) => !v)}>
              {showDevSetup ? 'Hide developer setup' : 'Developer setup'} {devReady ? '✓' : '— required'}
            </button>
            {showDevSetup && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  App-level OAuth credentials, configured once by the Larund developer so every user can connect. They live in <code>.env</code> / your backend — never a user token. Register <code>{redirectUriFor()}</code> as the redirect URI in the provider console.
                </div>
                {appKeys.map((key) => {
                  const configured = getProviderSecretSource(providerId, key) !== 'missing';
                  const required = auth.appCredentials.requiredEnv.includes(key);
                  return (
                    <div key={key} style={{ marginTop: 8 }}>
                      <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{key}{required ? '' : ' (optional)'}</code>
                      <input style={{ ...input, marginTop: 4 }} type="password" value={appValues[key] ?? ''}
                        onChange={(e) => setAppValues((c) => ({ ...c, [key]: e.target.value }))}
                        placeholder={configured ? 'Configured: ******' : 'Paste value'} />
                    </div>
                  );
                })}
                <button style={{ ...btn, marginTop: 10 }} onClick={saveAppCreds}>Save developer credentials</button>
              </>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 12 }}>Write, send, publish, and destructive tools require approval before Larund runs them.</div>
        {schema.notes && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 6 }}>{schema.notes}</div>}
        {provider.docsUrl && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 4 }}>Provider docs: {provider.docsUrl}</div>}
        {status && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={ghostBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

function ProviderDetail({ provider, onBack, onChanged }: { provider: ResolvedCatalogProvider; onBack: () => void; onChanged: () => void }) {
  const [setup, setSetup] = useState(false);
  const [, force] = useState(0);
  const st = RUNTIME_LABEL[provider.runtime];
  const setupProviderId = provider.parentProviderId ?? provider.id;
  const hub: ConnectionProvider | undefined = getProvider(setupProviderId);
  const connectable = provider.supportsNativeApi || provider.supportsMcp;
  const connectLabel = provider.runtime === 'connected' ? 'Manage'
    : provider.runtime === 'needs_reconnect' ? 'Reconnect'
    : provider.runtime === 'developer_setup_missing' ? 'Developer setup'
    : provider.runtime === 'api_key_required' ? 'Add API key'
    : 'Connect';

  function setToolPolicy(tool: string, p: ToolPolicy) { localStorage.setItem(policyKey(provider.id, tool), p); force((n) => n + 1); }

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> Connections</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <BrandIcon providerId={provider.id} size={52} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>{provider.name}</h1>
            <Badge text={st.text} color={st.color} />
            <ImplBadges p={provider} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{provider.description}</p>
        </div>
        {connectable && (
          <button style={provider.runtime === 'connected' ? ghostBtn : btn} onClick={() => setSetup(true)}>{connectLabel}</button>
        )}
      </div>

      {provider.runtime === 'developer_setup_missing' && (
        <div style={{ ...card, borderColor: 'var(--warning)', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Larund developer credentials for {provider.name} are not configured. Set the app-level OAuth keys to let users connect their own accounts.
        </div>
      )}

      {/* Implementation options */}
      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>How to connect</div>
        {provider.implementations.map((impl, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <Icon name={impl.kind === 'native_api' ? 'link' : impl.kind === 'remote_mcp' || impl.kind === 'local_mcp' ? 'diamond' : 'settings'} size={14} stroke={1.7} style={{ color: 'var(--accent)', marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>
                {impl.kind === 'native_api' && `Connect with ${impl.authType === 'oauth2' ? 'OAuth' : impl.authType === 'api_key' ? 'API key' : 'token'}`}
                {impl.kind === 'remote_mcp' && 'Connect via remote MCP server'}
                {impl.kind === 'local_mcp' && 'Connect via local MCP server (advanced)'}
                {impl.kind === 'manual_setup' && 'Manual setup'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>
                {impl.kind === 'native_api' && (provider.parentProviderId ? 'Uses Google Workspace connection.' : connectable ? 'Native Larund integration.' : 'Native integration - coming soon.')}
                {impl.kind === 'remote_mcp' && 'Open the MCP page to add this server URL; Larund inspects tools before use.'}
                {impl.kind === 'local_mcp' && 'Run a local MCP server (Developer Mode).'}
                {impl.kind === 'manual_setup' && impl.instructions}
              </div>
            </div>
          </div>
        ))}
        {provider.supportsMcp && (
          <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 10, lineHeight: 1.5 }}>
            Only connect MCP servers you trust. MCP tools can read and modify data depending on permissions.
          </div>
        )}
      </div>

      {provider.setupInstructions && (
        <div style={card}>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Setup</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{provider.setupInstructions}</div>
          {provider.docsUrl && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 6 }}>{provider.docsUrl}</div>}
        </div>
      )}

      {/* Real tool/permission detail when native tools exist */}
      {hub && hub.tools.length > 0 ? (
        <>
          <div style={{ ...card }}>
            <strong style={{ fontSize: 13 }}>What Larund can do</strong>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>{hub.tools.length} tools · auth: {hub.authType}{hub.scopes.length ? ` · scopes: ${hub.scopes.join(', ')}` : ''}</div>
          </div>
          {RISK_GROUPS.map((group) => {
            const tools = hub.tools.filter((t) => group.risks.includes(t.risk));
            if (tools.length === 0) return null;
            return (
              <div key={group.label} style={card}>
                <div style={{ ...labelStyle, marginBottom: 8 }}>{group.label} tools</div>
                {tools.map((t) => {
                  const pol = getPolicy(provider.id, t.name, t.risk);
                  return (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{t.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{t.description}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flex: 'none' }}>
                        {(['allow', 'ask', 'block'] as ToolPolicy[]).map((opt) => (
                          <button key={opt} onClick={() => setToolPolicy(t.name, opt)} style={{
                            fontSize: 10.5, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--border)',
                            background: pol === opt ? (opt === 'block' ? 'var(--danger)' : opt === 'ask' ? 'var(--warning)' : 'var(--success)') : 'transparent',
                            color: pol === opt ? '#04122a' : 'var(--text-hint)', fontWeight: pol === opt ? 650 : 400,
                          }}>{opt === 'ask' ? 'Ask' : opt === 'allow' ? 'Allow' : 'Block'}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      ) : (
        provider.runtime === 'coming_soon' && (
          <div style={{ ...card, borderColor: 'var(--warning)', color: 'var(--text-muted)', fontSize: 12.5 }}>
            This integration is on the roadmap. Its native tools aren't implemented yet{provider.supportsMcp ? ' — but you can connect it today via an MCP server' : ''}.
          </div>
        )
      )}

      {setup && <SetupModal providerId={setupProviderId} provider={provider} name={provider.parentProviderId ? 'Google Workspace' : provider.name} onClose={() => setSetup(false)} onSaved={onChanged} />}
    </PageFrame>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const [base, setBase] = useState<ResolvedCatalogProvider[]>(() => listCatalogProviders());
  // Live runtime overrides for MCP/CLI-backed providers, whose real state lives in
  // the async MCP store and can't be seen by the synchronous catalog resolver.
  const [mcpRuntime, setMcpRuntime] = useState<Record<string, RuntimeConnectionState>>({});
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  function refresh() { setBase(listCatalogProviders()); void loadMcpRuntime(); }

  async function loadMcpRuntime() {
    const ctx = { userId: 'local', workspaceId: getActiveWorkspaceId() };
    const overrides: Record<string, RuntimeConnectionState> = {};
    for (const p of listCatalogProviders()) {
      // Only MCP-primary providers; native-first ones keep their registry state so
      // a stale MCP server can never downgrade a working native connection.
      if (p.status !== 'mcp_available') continue;
      try {
        const s = p.id === 'higgsfield'
          ? (await higgsfieldConnectionState(ctx)).state
          : (await mcpProviderState(p.id, ctx)).state;
        const mapped = mcpStateToRuntime(s);
        if (mapped) overrides[p.id] = mapped;
      } catch { /* leave catalog base state */ }
    }
    setMcpRuntime(overrides);
  }
  useEffect(() => { void loadMcpRuntime(); /* eslint-disable-next-line */ }, []);

  // Overlay live MCP state onto the catalog base.
  const providers = base.map((p) => (mcpRuntime[p.id] ? { ...p, runtime: mcpRuntime[p.id] } : p));
  const selected = providers.find((p) => p.id === selectedId);
  if (selected?.id === 'higgsfield') return <HiggsfieldDetail onBack={() => { setSelectedId(null); refresh(); }} />;
  if (selected) return <ProviderDetail provider={selected} onBack={() => { setSelectedId(null); refresh(); }} onChanged={refresh} />;

  const NEEDS_SETUP: RuntimeConnectionState[] = ['ready_to_connect', 'api_key_required', 'developer_setup_missing', 'needs_reconnect'];
  function matches(p: ResolvedCatalogProvider): boolean {
    if (query && !`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())) return false;
    switch (filter) {
      case 'All': return true;
      case 'Connected': return p.runtime === 'connected' || p.runtime === 'dev_shortcut_active';
      case 'Needs setup': return NEEDS_SETUP.includes(p.runtime);
      case 'Native API': return p.supportsNativeApi;
      case 'MCP available': return p.supportsMcp;
      default: return p.category === filter.toLowerCase();
    }
  }

  const all = providers.filter(matches);
  // Connected connections lead the grid; everything not-yet-connected follows.
  const byRank = (a: ResolvedCatalogProvider, b: ResolvedCatalogProvider) =>
    STATE_RANK[a.runtime] - STATE_RANK[b.runtime] || a.name.localeCompare(b.name);
  const main = all.filter((p) => p.runtime !== 'coming_soon').sort(byRank);
  const upcoming = showUpcoming ? all.filter((p) => p.runtime === 'coming_soon') : [];

  const Card = ({ p }: { p: ResolvedCatalogProvider }) => {
    const st = RUNTIME_LABEL[p.runtime];
    // Connected cards render at full strength; not-yet-connected ones are only
    // slightly subdued so the connection state reads without burying them.
    const live = isLiveConnection(p.runtime);
    return (
      <button onClick={() => setSelectedId(p.id)} className="conn-card" style={{
        cursor: 'pointer',
        opacity: live ? 1 : 0.82,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <BrandIcon providerId={p.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'capitalize' }}>{p.category}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, minHeight: 34 }}>{p.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 9 }}>
          <span style={{ fontSize: 11, color: st.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ background: st.color }} /> {st.text}</span>
          <div style={{ flex: 1 }} />
          <ImplBadges p={p} />
        </div>
        {p.nativeToolCount > 0 && <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 7 }}>{p.nativeToolCount} tools</div>}
      </button>
    );
  };

  const Grid = ({ items }: { items: ResolvedCatalogProvider[] }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {items.map((p) => <Card key={p.id} p={p} />)}
    </div>
  );

  return (
    <PageFrame>
      <PageHeader title="Connections" subtitle="Connect Larund to the tools you already use." />
      <SearchInput value={query} onChange={setQuery} placeholder="Search connections…" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {FILTERS.map((c) => (
          <button key={c} onClick={() => setFilter(c)} style={{ ...ghostBtn, ...(filter === c ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{c}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowUpcoming((v) => !v)} style={{ ...ghostBtn, ...(showUpcoming ? { color: 'var(--accent)', borderColor: 'rgba(74,158,255,.4)' } : {}) }}>
          {showUpcoming ? 'Hide upcoming' : 'Show upcoming'}
        </button>
      </div>

      <Grid items={main} />
      {main.length === 0 && upcoming.length === 0 && <Empty text="No connections match your search." icon="link" />}

      {upcoming.length > 0 && (
        <>
          <div style={{ ...labelStyle, margin: '22px 0 10px' }}>Available soon</div>
          <Grid items={upcoming} />
        </>
      )}
    </PageFrame>
  );
}
