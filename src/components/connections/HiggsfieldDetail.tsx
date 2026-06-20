// Higgsfield connection detail. Real MCP-first connection UI: connect via the
// Higgsfield CLI (account login, no API key) or a remote MCP URL, inspect/scan the
// discovered tools, approve them, and test the connection. Status is never faked —
// "Connected" only appears after a successful inspect/test.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { card, btn, ghostBtn, dangerBtn, input, labelStyle, Badge, PageFrame } from '../pages/ui';
import type { McpToolSnapshot, McpServerConfig } from '../../lib/mcp/types';
import { setMcpToolApproval } from '../../lib/mcp/store';
import { mcpClient } from '../../lib/mcp/client';
import {
  higgsfieldConnectionState, connectHiggsfieldCli, connectHiggsfieldRemote,
  setHiggsfieldMcpUrl, disconnectHiggsfield, higgsfieldDefaultMcpUrl,
  type HiggsfieldState,
} from '../../lib/mcp/higgsfield/connect';
import { probeHiggsfieldCli, HIGGSFIELD_INSTALL_HINTS } from '../../lib/mcp/higgsfield/cli';

const STATE_LABEL: Record<HiggsfieldState, { text: string; color: string }> = {
  not_configured: { text: 'Add MCP URL or use CLI', color: 'var(--text-hint)' },
  ready_to_inspect: { text: 'Ready to inspect', color: 'var(--accent)' },
  auth_required: { text: 'Sign in to Higgsfield', color: 'var(--warning)' },
  cli_not_installed: { text: 'CLI not installed', color: 'var(--warning)' },
  connected: { text: 'Connected', color: 'var(--success)' },
  review_tools: { text: 'Review tools', color: 'var(--warning)' },
  ready: { text: 'Ready to use', color: 'var(--success)' },
  error: { text: 'Error', color: 'var(--danger)' },
};

const RISK_COLOR: Record<string, string> = {
  read_only: 'var(--success)', external_read: 'var(--accent)', local_write: 'var(--warning)',
  external_write: 'var(--warning)', external_send: 'var(--danger)', destructive: 'var(--danger)',
  process_exec: 'var(--danger)', credential_access: 'var(--danger)',
};

function toolStatus(t: McpToolSnapshot): { text: string; color: string } {
  if (t.flags.some((f) => f.kind === 'metadata_changed')) return { text: 'changed — re-review', color: 'var(--warning)' };
  if (t.approved && t.enabled) return { text: 'approved', color: 'var(--success)' };
  if (!t.enabled && t.flags.some((f) => f.severity === 'critical')) return { text: 'blocked', color: 'var(--danger)' };
  return { text: 'pending review', color: 'var(--text-hint)' };
}

export function HiggsfieldDetail({ projectId, onBack }: { projectId?: string | null; onBack: () => void }) {
  const ctx = { userId: 'local', workspaceId: projectId ?? undefined };
  const [state, setState] = useState<HiggsfieldState>('not_configured');
  const [server, setServer] = useState<McpServerConfig | undefined>();
  const [tools, setTools] = useState<McpToolSnapshot[]>([]);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState(higgsfieldDefaultMcpUrl() ?? '');
  const [busy, setBusy] = useState<string>('');
  const [showCli, setShowCli] = useState(false);

  async function refresh() {
    const s = await higgsfieldConnectionState(ctx);
    setState(s.state); setServer(s.server); setTools(s.tools);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [projectId]);

  async function run(label: string, fn: () => Promise<{ state: HiggsfieldState; server?: McpServerConfig; tools: McpToolSnapshot[]; message: string }>) {
    setBusy(label); setMessage('');
    try {
      const s = await fn();
      setState(s.state); setServer(s.server); setTools(s.tools); setMessage(s.message);
    } catch (e) {
      setMessage(`Failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally { setBusy(''); }
  }

  async function testConnection() {
    setBusy('test'); setMessage('');
    try {
      if (server?.transport === 'cli_adapter' || !server) {
        const probe = await probeHiggsfieldCli();
        setMessage(`${probe.state === 'ready' ? '✓' : '✗'} ${probe.message}${probe.version ? ` (${probe.version})` : ''}`);
      } else {
        const h = await mcpClient().healthCheck(server.id);
        setMessage(`${h.ok ? '✓' : '✗'} ${h.message}`);
      }
      await refresh();
    } finally { setBusy(''); }
  }

  async function setApproval(tool: McpToolSnapshot, approved: boolean) {
    await setMcpToolApproval(tool.id, { approved, enabled: approved });
    await refresh();
  }

  const st = STATE_LABEL[state];
  const pendingCount = tools.filter((t) => !(t.approved && t.enabled)).length;

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> Connections</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <BrandIcon providerId="higgsfield" size={52} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>Higgsfield</h1>
            <Badge text={st.text} color={st.color} />
            <Badge text="MCP available" color="#7C3AED" />
            <Badge text="CLI available" color="var(--accent)" />
            <Badge text="No API key" color="var(--success)" />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>Generate images, video and audio through your Higgsfield account.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} disabled={!!busy} onClick={testConnection}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          {server && server.status !== 'not_connected' && (
            <button style={dangerBtn} disabled={!!busy} onClick={async () => { if (server) { await disconnectHiggsfield(server.id); await refresh(); } }}>Disconnect</button>
          )}
        </div>
      </div>

      {/* 1. Overview */}
      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Overview</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Image / video / audio generation, model & workflow catalog, file upload, job polling, and account/credits.
          <br /><strong style={{ color: 'var(--text-primary)' }}>Auth:</strong> your Higgsfield account (CLI login or MCP). No API key, no developer app keys.
        </div>
      </div>

      {/* 2. Setup methods + 3. Connection status */}
      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Setup</div>

        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>Higgsfield CLI (recommended)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={btn} disabled={!!busy} onClick={() => run('cli', () => connectHiggsfieldCli(ctx))}>{busy === 'cli' ? 'Inspecting…' : 'Use CLI login & inspect'}</button>
          <button style={ghostBtn} onClick={() => setShowCli((v) => !v)}>{showCli ? 'Hide steps' : 'Show steps'}</button>
        </div>
        {showCli && (
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 8, lineHeight: 1.6 }}>
            1. Install the CLI: <code>{HIGGSFIELD_INSTALL_HINTS[0]}</code><br />
            2. Sign in: <code>higgsfield auth login</code> (opens in your browser)<br />
            3. Back here, click <strong>Use CLI login &amp; inspect</strong>. Larund detects the CLI, discovers tools, and you approve them.
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, margin: '14px 0 4px' }}>Remote MCP server</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: 1, minWidth: 220 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" />
          <button style={ghostBtn} disabled={!!busy || !url.trim()} onClick={async () => { await setHiggsfieldMcpUrl(url, ctx); await refresh(); setMessage('MCP URL saved. Click Connect & inspect.'); }}>Add MCP URL</button>
          <button style={btn} disabled={!!busy || !url.trim()} onClick={() => run('remote', () => connectHiggsfieldRemote(url, ctx))}>{busy === 'remote' ? 'Connecting…' : 'Connect & inspect'}</button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: st.color }} />
          <span style={{ color: st.color, fontWeight: 600 }}>{st.text}</span>
          {message && <span style={{ color: 'var(--text-muted)' }}>· {message}</span>}
        </div>
        {state === 'auth_required' && (
          <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 6 }}>Run <code>higgsfield auth login</code> in a terminal, then Test connection.</div>
        )}
      </div>

      {/* 4/5. Discovered tools + permissions */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={labelStyle}>Discovered tools {tools.length > 0 && `(${tools.length})`}</div>
          {pendingCount > 0 && <Badge text={`${pendingCount} to review`} color="var(--warning)" />}
        </div>
        {tools.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>No tools yet. Connect & inspect to discover the Higgsfield tool catalog.</div>
        ) : (
          tools.map((t) => {
            const ts = toolStatus(t);
            const critical = t.flags.filter((f) => f.severity === 'critical');
            return (
              <div key={t.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{t.title ?? t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{t.name}</div>
                  </div>
                  <Badge text={t.risk} color={RISK_COLOR[t.risk] ?? 'var(--text-hint)'} />
                  <Badge text={ts.text} color={ts.color} />
                  <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => setApproval(t, true)}>Approve</button>
                  <button style={{ ...dangerBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => setApproval(t, false)}>Block</button>
                </div>
                {t.description && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{t.description}</div>}
                {critical.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>⚠ {critical.map((f) => f.message).join(' ')}</div>
                )}
              </div>
            );
          })
        )}
        {tools.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 8 }}>
            Generation and uploads are approval-gated at run time. Unapproved tools are never exposed to the agent.
          </div>
        )}
      </div>

      {/* 6. Evidence + 7. Troubleshooting */}
      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Evidence &amp; safety</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Every Higgsfield call records evidence (tool, risk, sanitized args, result/job id, output URL). Auth tokens, headers, and secrets are never logged or shown.
        </div>
      </div>
      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Troubleshooting</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong>CLI not found:</strong> {HIGGSFIELD_INSTALL_HINTS.join(' · ')}<br />
          <strong>Auth required:</strong> run <code>higgsfield auth login</code>, then Test connection.<br />
          <strong>Remote MCP needs sign-in:</strong> complete the server’s OAuth, or use the CLI path.
        </div>
      </div>
    </PageFrame>
  );
}
