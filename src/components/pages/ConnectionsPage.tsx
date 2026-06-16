// Connections — a polished app/connector directory (ChatGPT Apps / Claude
// Connectors style). It is a product-grade view over the existing connection
// manifests + secrets store; tool execution still flows through
// `connection.call` → ConnectionRegistry, unchanged. Scaffolded providers are
// clearly marked "Coming soon" — we never pretend a provider works.

import { useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { listProviders, planConnectionTest } from '../../lib/connections/hub/status';
import type { ConnectionProvider, ProviderCategory } from '../../lib/connections/hub/types';
import type { ToolRisk } from '../../lib/control-system/types';
import { setPersistentSecret, getSecret } from '../../lib/connections/secrets';
import {
  PageFrame, PageHeader, Empty, SearchInput, Badge,
  card, btn, ghostBtn, input, labelStyle,
} from './ui';

// Aspirational providers not yet wired to a runtime. Shown as "Coming soon" so
// the directory feels complete without faking functionality.
const COMING_SOON: Array<{ id: string; name: string; category: ProviderCategory; description: string }> = [
  { id: 'gmail', name: 'Gmail', category: 'communication', description: 'Triage, draft and send email (part of Google Workspace).' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'productivity', description: 'Read and manage events and scheduling.' },
  { id: 'figma', name: 'Figma', category: 'development', description: 'Read designs and sync code with design.' },
  { id: 'canva', name: 'Canva', category: 'marketing', description: 'Generate and edit visual designs.' },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'productivity', description: 'Word, Excel, Outlook and OneDrive.' },
  { id: 'supabase', name: 'Supabase', category: 'development', description: 'Query databases and manage projects.' },
  { id: 'vercel', name: 'Vercel', category: 'development', description: 'Deploy and inspect frontend projects.' },
  { id: 'linear', name: 'Linear', category: 'productivity', description: 'Track issues and project work.' },
];

const CATEGORIES = ['All', 'Connected', 'Productivity', 'Development', 'Marketing', 'Communication', 'Data'] as const;
type Cat = typeof CATEGORIES[number];

const RISK_GROUPS: Array<{ label: string; risks: ToolRisk[] }> = [
  { label: 'Read-only', risks: ['read_only', 'external_read'] },
  { label: 'Write', risks: ['local_write', 'external_write'] },
  { label: 'Send / publish', risks: ['external_send'] },
  { label: 'Destructive', risks: ['destructive', 'process_exec'] },
];

type ToolPolicy = 'allow' | 'ask' | 'block';
function policyKey(provider: string, tool: string) { return `conn_tool_policy:${provider}:${tool}`; }
function getPolicy(provider: string, tool: string, risk: ToolRisk): ToolPolicy {
  const stored = localStorage.getItem(policyKey(provider, tool));
  if (stored === 'allow' || stored === 'ask' || stored === 'block') return stored;
  // Safe defaults: send/destructive ask every time, the rest allow.
  return risk === 'external_send' || risk === 'destructive' || risk === 'process_exec' ? 'ask' : 'allow';
}

function statusLabel(p: ConnectionProvider): { text: string; color: string } {
  if (p.scaffold) return { text: 'Coming soon', color: 'var(--warning)' };
  if (p.status === 'configured') return { text: 'Connected', color: 'var(--success)' };
  if (p.status === 'missing_auth') return { text: 'Needs setup', color: 'var(--warning)' };
  return { text: 'Not connected', color: 'var(--text-hint)' };
}

function ProviderIcon({ providerId, size = 38 }: { providerId: string; size?: number }) {
  return <BrandIcon providerId={providerId} size={size} />;
}

function SetupModal({ provider, onClose, onSaved }: { provider: ConnectionProvider; onClose: () => void; onSaved: () => void }) {
  const isGoogle = provider.id === 'google-workspace';
  const secretKey = isGoogle ? 'GOOGLE_WORKSPACE_ACCESS_TOKEN' : provider.envVars[0] ?? '';
  const [secret, setSecret] = useState(getSecret(secretKey) ?? '');
  const [email, setEmail] = useState(getSecret('GOOGLE_WORKSPACE_ACCOUNT_EMAIL') ?? '');
  const [status, setStatus] = useState('');

  async function save() {
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
      const plan = planConnectionTest({ ...provider, status: secret.trim() ? 'configured' : provider.status });
      setStatus(plan.runnable ? 'Credentials present — Larund can use this connection.' : plan.message ?? 'Not runnable.');
    }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 440, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <ProviderIcon providerId={provider.id} />
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>Connect {provider.name}</div><div style={{ fontSize: 12, color: 'var(--text-hint)' }}>{isGoogle ? 'OAuth access token' : 'API key'}</div></div>
        </div>
        {isGoogle && (
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>Account email</div>
            <input style={{ ...input, marginTop: 4 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
        )}
        <div>
          <div style={labelStyle}>{isGoogle ? 'OAuth access token' : `${provider.name} key`}</div>
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

function ProviderDetail({ provider, onBack, onChanged }: { provider: ConnectionProvider; onBack: () => void; onChanged: () => void }) {
  const [setup, setSetup] = useState(false);
  const [, force] = useState(0);
  const st = statusLabel(provider);

  function setToolPolicy(tool: string, p: ToolPolicy) { localStorage.setItem(policyKey(provider.id, tool), p); force((n) => n + 1); }

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> Connections</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <ProviderIcon providerId={provider.id} size={52} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>{provider.name}</h1>
            <Badge text={st.text} color={st.color} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{provider.description}</p>
        </div>
        {!provider.scaffold && (
          provider.status === 'configured'
            ? <button style={ghostBtn} onClick={() => setSetup(true)}>Manage</button>
            : <button style={btn} onClick={() => setSetup(true)}>Connect</button>
        )}
      </div>

      {provider.scaffold && (
        <div style={{ ...card, borderColor: 'var(--warning)', color: 'var(--text-muted)', fontSize: 12.5 }}>
          This connector is scaffolded but not yet runnable. It's coming soon — its tools are visible so you can plan ahead, but Larund won't call them.
        </div>
      )}

      <div style={card}>
        <strong style={{ fontSize: 13 }}>What Larund can do</strong>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>{provider.tools.length} tools · auth: {provider.authType}{provider.scopes.length ? ` · scopes: ${provider.scopes.join(', ')}` : ''}</div>
      </div>

      {RISK_GROUPS.map((group) => {
        const tools = provider.tools.filter((t) => group.risks.includes(t.risk));
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

      {setup && <SetupModal provider={provider} onClose={() => setSetup(false)} onSaved={onChanged} />}
    </PageFrame>
  );
}

export function ConnectionsPage() {
  const [providers, setProviders] = useState<ConnectionProvider[]>(() => listProviders());
  const [cat, setCat] = useState<Cat>('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ConnectionProvider | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  function refresh() { setProviders(listProviders()); if (selected) setSelected(listProviders().find((p) => p.id === selected.id) ?? null); }

  if (selected) return <ProviderDetail provider={selected} onBack={() => setSelected(null)} onChanged={refresh} />;

  // Real, runnable providers (registry) are "implemented". Everything else —
  // registry scaffolds + aspirational entries — is "upcoming" and hidden by
  // default behind the toggle so the default page only shows usable connectors.
  const implemented = providers.filter((p) => !p.scaffold);
  const registryUpcoming = providers.filter((p) => p.scaffold);
  const comingSoon: ConnectionProvider[] = COMING_SOON.map((c) => ({
    id: c.id, name: c.name, category: c.category, description: c.description,
    authType: 'oauth', tools: [], status: 'available', scaffold: true, envVars: [], scopes: [],
  }));
  const upcoming = [...registryUpcoming, ...comingSoon];

  function applyFilters(list: ConnectionProvider[]) {
    return list.filter((p) => {
      if (query && !`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (cat === 'All') return true;
      if (cat === 'Connected') return !p.scaffold && p.status === 'configured';
      return p.category === cat.toLowerCase();
    });
  }
  const filtered = applyFilters(implemented);
  const filteredUpcoming = showUpcoming && cat !== 'Connected' ? applyFilters(upcoming) : [];

  const Grid = ({ items }: { items: ConnectionProvider[] }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {items.map((p) => renderCard(p))}
    </div>
  );

  function renderCard(p: ConnectionProvider) {
    const st = statusLabel(p);
    const isReal = providers.some((x) => x.id === p.id) && !p.scaffold;
    return (
      <button key={p.id} onClick={() => { if (isReal) setSelected(p); }} className="conn-card" style={{ cursor: isReal ? 'pointer' : 'default', opacity: isReal ? 1 : 0.72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ProviderIcon providerId={p.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'capitalize' }}>{p.category}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, minHeight: 34 }}>{p.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: st.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className="dot" style={{ background: st.color }} /> {st.text}</span>
          <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>{p.scaffold ? '' : p.status === 'configured' ? 'Manage' : 'Connect'}</span>
        </div>
      </button>
    );
  }

  return (
    <PageFrame>
      <PageHeader title="Connections" subtitle="Connect Larund to the tools you already use." />
      <SearchInput value={query} onChange={setQuery} placeholder="Search connections…" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)} style={{ ...ghostBtn, ...(cat === c ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{c}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowUpcoming((v) => !v)} style={{ ...ghostBtn, ...(showUpcoming ? { color: 'var(--accent)', borderColor: 'rgba(74,158,255,.4)' } : {}) }}>
          {showUpcoming ? 'Hide upcoming' : 'Show upcoming'}
        </button>
      </div>

      <Grid items={filtered} />
      {filtered.length === 0 && <Empty text="No connections match your search." icon="link" />}

      {filteredUpcoming.length > 0 && (
        <>
          <div style={{ ...labelStyle, margin: '22px 0 10px' }}>Available soon · not yet runnable</div>
          <Grid items={filteredUpcoming} />
        </>
      )}
    </PageFrame>
  );
}
