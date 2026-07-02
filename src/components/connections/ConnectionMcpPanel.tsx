import { useEffect, useState } from 'react';
import { card, btn, ghostBtn, input, labelStyle } from '../pages/ui';
import {
  connectMcpProvider,
  disconnectMcpProvider,
  mcpProviderState,
  setMcpProviderUrl,
  type McpProviderState,
} from '../../lib/mcp/connect-provider';

const MCP_STATE_LABEL: Record<McpProviderState, { text: string; color: string }> = {
  not_configured: { text: 'Add MCP URL', color: 'var(--text-hint)' },
  ready_to_inspect: { text: 'Ready to inspect', color: 'var(--accent)' },
  auth_required: { text: 'Sign in required', color: 'var(--warning)' },
  connected: { text: 'Connected', color: 'var(--success)' },
  review_tools: { text: 'Review tools', color: 'var(--warning)' },
  ready: { text: 'Ready to use', color: 'var(--success)' },
  error: { text: 'Error', color: 'var(--danger)' },
};

export function ConnectionMcpPanel({
  providerId,
  name,
  defaultUrl,
  userId,
  projectId,
  onChanged,
}: {
  providerId: string;
  name: string;
  defaultUrl?: string;
  userId: string;
  projectId?: string | null;
  onChanged: () => void;
}) {
  const ctx = { userId, workspaceId: projectId ?? undefined };
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [state, setState] = useState<McpProviderState>('not_configured');
  const [serverId, setServerId] = useState<string | undefined>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    const status = await mcpProviderState(providerId, ctx);
    setState(status.state);
    setServerId(status.server?.id);
    if (status.server?.url && !url) setUrl(status.server.url);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, userId, projectId]);

  async function connect() {
    if (!url.trim()) {
      setMessage('Enter the MCP server URL to connect.');
      return;
    }
    setBusy('connect');
    setMessage('');
    try {
      const status = await connectMcpProvider(providerId, name, url, ctx);
      setState(status.state);
      setServerId(status.server?.id);
      setMessage(status.message);
      onChanged();
    } catch (error) {
      setMessage(`Connect failed: ${String(error instanceof Error ? error.message : error)}`);
    } finally {
      setBusy('');
    }
  }

  const label = MCP_STATE_LABEL[state];
  const hasDefault = Boolean(defaultUrl);

  return (
    <div style={{ ...card, marginTop: 12 }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Connect via MCP server</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
        {hasDefault
          ? `One click connects ${name} through its hosted MCP server. Larund inspects the tools before any run.`
          : `Paste a ${name} MCP server URL. Larund inspects the tools before any run.`}
      </div>
      <input style={input} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://.../mcp" />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={connect}>
          {busy === 'connect' ? 'Connecting...' : state === 'connected' || state === 'ready' ? 'Reconnect & inspect' : 'Connect & inspect'}
        </button>
        {!hasDefault && (
          <button
            style={ghostBtn}
            disabled={!!busy || !url.trim()}
            onClick={async () => {
              await setMcpProviderUrl(providerId, name, url, ctx);
              await refresh();
              setMessage('MCP URL saved.');
            }}
          >
            Save URL
          </button>
        )}
        {serverId && (state === 'connected' || state === 'ready' || state === 'review_tools') && (
          <button
            style={ghostBtn}
            disabled={!!busy}
            onClick={async () => {
              await disconnectMcpProvider(serverId);
              await refresh();
              setMessage('Disconnected.');
              onChanged();
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="dot" style={{ background: label.color }} />
        <span style={{ color: label.color, fontWeight: 600 }}>{label.text}</span>
        {message && <span style={{ color: 'var(--text-muted)' }}>· {message}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>
        Only connect providers and MCP servers you trust. Discovered tools start unapproved and must be reviewed before use.
      </div>
    </div>
  );
}
