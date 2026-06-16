// Connections — a polished app/connector directory backed by the connection
// catalog (40+ providers) reconciled with live runtime state. It is a metadata +
// setup layer over the runtime ConnectionRegistry / MCP client; tool execution is
// unchanged. We never fake capability: a card's badge reflects real status
// (Connected / Needs setup / MCP available / Coming soon) and only providers with
// real native tools expose a tool/permission detail.

import { useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { getProvider } from '../../lib/connections/hub/status';
import type { ConnectionProvider } from '../../lib/connections/hub/types';
import type { ToolRisk } from '../../lib/control-system/types';
import { listCatalogProviders } from '../../lib/connections/catalog';
import type { ResolvedCatalogProvider } from '../../lib/connections/catalog';
import { ALL_MANIFESTS } from '../../lib/connections/registry';
import { setPersistentSecret, getSecret } from '../../lib/connections/secrets';
import {
  PageFrame, PageHeader, Empty, SearchInput, Badge,
  card, btn, ghostBtn, input, labelStyle,
} from './ui';

const FILTERS = ['All', 'Connected', 'Needs setup', 'Native API', 'MCP available', 'Productivity', 'Marketing', 'Development', 'Communication', 'Data'] as const;
type Filter = typeof FILTERS[number];

const RUNTIME_LABEL: Record<ResolvedCatalogProvider['runtime'], { text: string; color: string }> = {
  connected: { text: 'Connected', color: 'var(--success)' },
  needs_setup: { text: 'Needs setup', color: 'var(--warning)' },
  available: { text: 'Available', color: 'var(--accent)' },
  coming_soon: { text: 'Coming soon', color: 'var(--text-hint)' },
};

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

/** Secret key for a provider's native credential, when it has a registry manifest. */
function secretKeyFor(id: string): string | undefined {
  if (id === 'google-workspace') return 'GOOGLE_WORKSPACE_ACCESS_TOKEN';
  const m = ALL_MANIFESTS.find((x) => x.id === id);
  return m?.auth.envVars?.[0];
}

function ImplBadges({ p }: { p: ResolvedCatalogProvider }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {p.supportsNativeApi && <Badge text="Native API" color="var(--accent)" />}
      {p.supportsMcp && <Badge text="MCP available" color="#7C3AED" />}
    </div>
  );
}

// ── Setup modal (native API / token providers) ────────────────────────────────

function SetupModal({ providerId, name, onClose, onSaved }: { providerId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const isGoogle = providerId === 'google-workspace';
  const secretKey = secretKeyFor(providerId) ?? '';
  const [secret, setSecret] = useState(getSecret(secretKey) ?? '');
  const [email, setEmail] = useState(getSecret('GOOGLE_WORKSPACE_ACCOUNT_EMAIL') ?? '');
  const [status, setStatus] = useState('');

  async function save() {
    if (!secretKey) { setStatus('This provider is not yet runnable.'); return; }
    await setPersistentSecret(secretKey, secret.trim());
    if (isGoogle) await setPersistentSecret('GOOGLE_WORKSPACE_ACCOUNT_EMAIL', email.trim());
    setStatus(secret.trim() ? 'Saved.' : 'Cleared.');
    onSaved();
    if (secret.trim()) setTimeout(onClose, 500);
  }
  async function test() {
    if (isGoogle) {
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${secret.trim()}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { email?: string };
        if (data.email) setEmail(data.email);
        setStatus(`Connected${data.email ? ` as ${data.email}` : ''}.`);
      } catch (e) { setStatus(`Test failed: ${String(e)}`); }
    } else {
      setStatus(secret.trim() ? 'Credentials saved — Larund can use this connection.' : 'Enter a credential to connect.');
    }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 440, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <BrandIcon providerId={providerId} />
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>Connect {name}</div><div style={{ fontSize: 12, color: 'var(--text-hint)' }}>{isGoogle ? 'OAuth access token' : 'API key / token'}</div></div>
        </div>
        {isGoogle && (
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>Account email</div>
            <input style={{ ...input, marginTop: 4 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        )}
        <div>
          <div style={labelStyle}>{isGoogle ? 'OAuth access token' : `${name} key`}</div>
          <input style={{ ...input, marginTop: 4 }} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={isGoogle ? 'ya29…' : 'Paste secret…'} />
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 5 }}>Stored securely on this device. Never written to prompts or logs.</div>
        </div>
        {status && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={ghostBtn} onClick={test}>Test connection</button>
          <div style={{ flex: 1 }} />
          <button style={btn} onClick={save}>Save</button>
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
  // Real tool/permission detail comes from the runtime hub provider (only the
  // providers with real native tools have one).
  const hub: ConnectionProvider | undefined = getProvider(provider.id);
  const connectable = Boolean(secretKeyFor(provider.id));

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
          provider.runtime === 'connected'
            ? <button style={ghostBtn} onClick={() => setSetup(true)}>Manage</button>
            : <button style={btn} onClick={() => setSetup(true)}>Connect</button>
        )}
      </div>

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
                {impl.kind === 'native_api' && (connectable ? 'Native Larund integration.' : 'Native integration — coming soon.')}
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

      {setup && <SetupModal providerId={provider.id} name={provider.name} onClose={() => setSetup(false)} onSaved={onChanged} />}
    </PageFrame>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const [providers, setProviders] = useState<ResolvedCatalogProvider[]>(() => listCatalogProviders());
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  function refresh() { setProviders(listCatalogProviders()); }
  const selected = providers.find((p) => p.id === selectedId);
  if (selected) return <ProviderDetail provider={selected} onBack={() => setSelectedId(null)} onChanged={refresh} />;

  function matches(p: ResolvedCatalogProvider): boolean {
    if (query && !`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())) return false;
    switch (filter) {
      case 'All': return true;
      case 'Connected': return p.runtime === 'connected';
      case 'Needs setup': return p.runtime === 'needs_setup';
      case 'Native API': return p.supportsNativeApi;
      case 'MCP available': return p.supportsMcp;
      default: return p.category === filter.toLowerCase();
    }
  }

  const all = providers.filter(matches);
  const main = all.filter((p) => p.runtime !== 'coming_soon');
  const upcoming = showUpcoming ? all.filter((p) => p.runtime === 'coming_soon') : [];

  const Card = ({ p }: { p: ResolvedCatalogProvider }) => {
    const st = RUNTIME_LABEL[p.runtime];
    const clickable = p.runtime !== 'coming_soon' || p.supportsMcp;
    return (
      <button onClick={() => setSelectedId(p.id)} className="conn-card" style={{ cursor: 'pointer', opacity: clickable ? 1 : 0.78 }}>
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
