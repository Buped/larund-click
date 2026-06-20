// MCP — add custom tool servers (Claude Custom Connector style). Remote HTTP
// servers are the primary path; tools are discovered, security-scanned, and must
// be reviewed before Larund can use them. Untrusted by default; dangerous tools
// (send/destructive/process/credential) default to "Ask every time" and cannot
// auto-run. The mock server is NOT here — it lives in Settings → Developer.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { createMcpServer, listMcpServers, listMcpTools, setMcpToolApproval, deleteMcpServer } from '../../lib/mcp/store';
import { connectMcpServer, discoverMcpTools } from '../../lib/mcp/discovery';
import type { McpServerConfig, McpToolSnapshot, McpTrustLevel } from '../../lib/mcp/types';
import type { ToolRisk } from '../../lib/control-system/types';
import {
  PageFrame, PageHeader, Empty, Badge, SearchInput,
  card, btn, ghostBtn, dangerBtn, input, labelStyle, statusColor, useAsyncList,
} from './ui';

const RISK_GROUPS: Array<{ label: string; risks: ToolRisk[]; danger?: boolean }> = [
  { label: 'Read-only', risks: ['read_only', 'external_read'] },
  { label: 'Write', risks: ['local_write', 'external_write'] },
  { label: 'Send / publish', risks: ['external_send'], danger: true },
  { label: 'Destructive / process', risks: ['destructive', 'process_exec'], danger: true },
];

function dangerousRisk(r: ToolRisk): boolean {
  return r === 'external_send' || r === 'destructive' || r === 'process_exec';
}

function AddServerModal({ userId, projectId, onClose, onCreated }: { userId: string; projectId?: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'streamable_http' | 'stdio'>('streamable_http');
  const [command, setCommand] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [headers, setHeaders] = useState('');
  const [trust, setTrust] = useState<McpTrustLevel>('untrusted');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function connectInspect() {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (transport === 'streamable_http' && !url.trim()) { setErr('Remote MCP server URL is required.'); return; }
    setBusy(true); setErr('');
    try {
      let parsedHeaders: Record<string, string> | undefined;
      if (headers.trim()) {
        parsedHeaders = {};
        for (const line of headers.split('\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) parsedHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      if (clientId.trim() || clientSecret.trim()) {
        parsedHeaders = parsedHeaders ?? {};
        if (clientId.trim()) parsedHeaders['X-OAuth-Client-Id'] = clientId.trim();
      }
      const server = await createMcpServer({
        userId,
        workspaceId: projectId ?? undefined,
        name: name.trim(),
        description: transport === 'streamable_http' ? url.trim() : command.trim(),
        transport,
        url: transport === 'streamable_http' ? url.trim() : undefined,
        command: transport === 'stdio' ? command.trim() : undefined,
        headers: parsedHeaders,
        trustLevel: trust,
      });
      // Connect + discover so the user immediately reviews capabilities.
      try { await connectMcpServer(server.id); await discoverMcpTools(server.id); } catch { /* surfaced on detail */ }
      onCreated(server.id);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally { setBusy(false); }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop scroll" style={{ width: 480, maxHeight: '86vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Add MCP server</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>Connect a custom tool server. Tools are reviewed before Larund can use them.</div>

        <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="My tool server" /></Field>
        <Field label="Transport">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['streamable_http', 'stdio'] as const).map((t) => (
              <button key={t} onClick={() => setTransport(t)} style={{ ...ghostBtn, ...(transport === t ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{t === 'streamable_http' ? 'Remote HTTP' : 'Local stdio (advanced)'}</button>
            ))}
          </div>
        </Field>
        {transport === 'streamable_http'
          ? <Field label="Remote MCP server URL"><input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://server.example.com/mcp" /></Field>
          : <Field label="Command"><input style={input} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx my-mcp-server" /></Field>}
        <Field label="OAuth Client ID (optional)"><input style={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="optional" /></Field>
        <Field label="OAuth Client Secret (optional)"><input style={input} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="optional" /></Field>
        <Field label="Headers (optional, one per line: Key: Value)"><textarea style={{ ...input, minHeight: 50, resize: 'vertical' }} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" /></Field>
        <Field label="Trust level">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['untrusted', 'trusted'] as McpTrustLevel[]).map((t) => (
              <button key={t} onClick={() => setTrust(t)} style={{ ...ghostBtn, ...(trust === t ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{t}</button>
            ))}
          </div>
        </Field>

        {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button style={btn} onClick={connectInspect} disabled={busy}>{busy ? 'Connecting…' : 'Connect & inspect'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><div style={{ ...labelStyle, marginBottom: 4 }}>{label}</div>{children}</div>;
}

function ServerDetail({ server, onBack, onChanged }: { server: McpServerConfig; onBack: () => void; onChanged: () => void }) {
  const tools = useAsyncList<McpToolSnapshot>(() => listMcpTools(server.id), [server.id]);
  const [busy, setBusy] = useState(false);

  async function rescan() {
    setBusy(true);
    try { await connectMcpServer(server.id); await discoverMcpTools(server.id); tools.reload(); } finally { setBusy(false); }
  }
  async function setApproval(id: string, patch: { approved?: boolean; enabled?: boolean }) {
    await setMcpToolApproval(id, patch); tools.reload();
  }
  async function disconnect() {
    await deleteMcpServer(server.id); onChanged(); onBack();
  }

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> MCP servers</button>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{server.name}</h1>
            <Badge text={server.status} color={statusColor(server.status)} />
            <Badge text={server.trustLevel} color={statusColor(server.trustLevel)} />
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-hint)', margin: '4px 0 0', fontFamily: 'var(--font-mono)' }}>
            {server.transport === 'streamable_http' ? maskUrl(server.url) : server.command}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={rescan} disabled={busy}>{busy ? 'Scanning…' : 'Re-scan'}</button>
          <button style={dangerBtn} onClick={disconnect}>Disconnect</button>
        </div>
      </div>

      <div style={{ ...card, borderColor: 'var(--warning)', fontSize: 12, color: 'var(--text-muted)' }}>
        Tools from this server are untrusted by default and only run when explicitly approved. If the server changes a tool's metadata, its approval is reset.
      </div>

      {tools.loading && <div style={{ padding: 20, color: 'var(--text-hint)', fontSize: 12.5 }}>Loading tools…</div>}
      {!tools.loading && tools.items.length === 0 && <Empty text="No tools discovered yet. Try Re-scan." icon="diamond" />}

      {RISK_GROUPS.map((group) => {
        const groupTools = tools.items.filter((t) => group.risks.includes(t.risk));
        if (groupTools.length === 0) return null;
        return (
          <div key={group.label}>
            <div style={{ ...labelStyle, margin: '12px 0 6px', color: group.danger ? 'var(--danger)' : 'var(--text-hint)' }}>{group.label}</div>
            {groupTools.map((tool) => {
              const danger = dangerousRisk(tool.risk);
              return (
                <div key={tool.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 12.5 }}>{tool.title ?? tool.name}</strong>
                    <Badge text={tool.risk} color={statusColor(tool.risk)} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{tool.description}</div>
                  {tool.flags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                      {tool.flags.map((f, i) => <Badge key={i} text={`${f.severity}: ${f.kind.replace(/_/g, ' ')}`} color={statusColor(f.severity)} />)}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                    <button style={tool.approved ? ghostBtn : btn} onClick={() => setApproval(tool.id, { approved: !tool.approved, enabled: !tool.approved ? true : tool.enabled })}>
                      {tool.approved ? 'Approved' : 'Approve'}
                    </button>
                    <button style={tool.enabled ? dangerBtn : ghostBtn} onClick={() => setApproval(tool.id, { enabled: !tool.enabled })} disabled={!tool.approved}>
                      {tool.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {danger && <span style={{ fontSize: 11, color: 'var(--warning)', marginLeft: 'auto' }}>Ask every time — cannot auto-run</span>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </PageFrame>
  );
}

function maskUrl(url?: string): string {
  if (!url) return '';
  try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return url; }
}

export function McpPage({ userId, projectId }: { userId: string; projectId?: string | null }) {
  const servers = useAsyncList<McpServerConfig>(() => listMcpServers({ userId, workspaceId: projectId ?? undefined }), [userId, projectId]);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const selected = servers.items.find((s) => s.id === selectedId);
  useEffect(() => { if (selectedId && !selected && !servers.loading) setSelectedId(null); }, [selectedId, selected, servers.loading]);

  if (selected) return <ServerDetail server={selected} onBack={() => setSelectedId(null)} onChanged={servers.reload} />;

  const filtered = servers.items.filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <PageFrame>
      <PageHeader
        title="MCP"
        subtitle="Connect custom tool servers to Larund."
        actions={<button style={btn} onClick={() => setAdding(true)}><Icon name="plus" size={13} stroke={2} /> Add MCP server</button>}
      />
      {servers.items.length > 3 && <SearchInput value={query} onChange={setQuery} placeholder="Search servers…" />}

      {servers.loading && <div style={{ padding: 20, color: 'var(--text-hint)', fontSize: 12.5 }}>Loading…</div>}
      {!servers.loading && filtered.length === 0 && (
        <Empty text="No MCP servers yet. Add a remote server URL to discover its tools." icon="diamond" />
      )}
      {filtered.map((s) => (
        <button key={s.id} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{s.name}</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge text={s.status} color={statusColor(s.status)} />
              <Badge text={s.trustLevel} color={statusColor(s.trustLevel)} />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
            {s.transport === 'streamable_http' ? maskUrl(s.url) : s.command}
          </div>
        </button>
      ))}

      {adding && <AddServerModal userId={userId} projectId={projectId} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); servers.reload(); setSelectedId(id); }} />}
    </PageFrame>
  );
}
