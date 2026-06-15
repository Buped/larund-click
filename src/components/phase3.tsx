import React, { useEffect, useState } from 'react';
import { Icon } from './icons';
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  pauseAutomation,
  resumeAutomation,
} from '../lib/automations/store';
import { runAutomation } from '../lib/automations/runner';
import type { Automation, AutomationRun, AutomationTrigger } from '../lib/automations/types';
import { cancelQueuedTask, enqueueTask, listQueueItems, retryQueueItem } from '../lib/queue/store';
import type { TaskQueueItem } from '../lib/queue/types';
import { listNotifications, markRead } from '../lib/notifications/store';
import type { Notification } from '../lib/notifications/types';
import { createApprovalRequest, listApprovalRequests, resolveApprovalRequest } from '../lib/approvals/store';
import type { ApprovalRequestRecord } from '../lib/approvals/types';
import { createGatewayChannel, listGatewayChannels, listGatewayMessages } from '../lib/gateway/store';
import { routeGatewayMessage } from '../lib/gateway/router';
import type { GatewayChannel, GatewayMessage } from '../lib/gateway/types';
import { listWorkspaces } from '../lib/workspaces/store';
import type { Workspace } from '../lib/workspaces/types';

const card: React.CSSProperties = { background: 'rgba(22,22,20,0.72)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: 14, marginBottom: 10, boxShadow: '0 14px 34px rgba(0,0,0,0.18)' };
const btn: React.CSSProperties = { background: 'var(--accent)', color: '#04122a', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 650 };
const ghostBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.045)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };
const dangerBtn: React.CSSProperties = { ...ghostBtn, color: 'var(--danger)' };
const input: React.CSSProperties = { background: 'rgba(10,10,8,0.46)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' };

function tone(status: string): string {
  if (/completed|active|approved|linked|queued|running/.test(status)) return 'var(--success)';
  if (/waiting|pending|paused|skipped/.test(status)) return 'var(--warning)';
  if (/failed|error|denied|disabled|cancelled/.test(status)) return 'var(--danger)';
  return 'var(--text-hint)';
}

function useLoader<T>(loader: () => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader().then(
      (r) => { if (alive) { setItems(r); setLoading(false); } },
      (e) => { if (alive) { setError(String(e)); setLoading(false); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { items, loading, error, reload: () => setTick((t) => t + 1) };
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-hint)', fontSize: 12.5 }}>{text}</div>;
}

function ErrorBox({ text }: { text: string }) {
  return <div style={{ ...card, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{text}</div>;
}

function WorkspaceSelect({ userId, value, onChange }: { userId: string; value?: string; onChange: (id: string | undefined) => void }) {
  const workspaces = useLoader<Workspace>(() => listWorkspaces(userId), [userId]);
  return (
    <select style={input} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">No workspace</option>
      {workspaces.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
}

export function AutomationsTab({ userId }: { userId: string }) {
  const { items, loading, error, reload } = useLoader<Automation>(() => listAutomations({ userId, includeDisabled: true }), [userId]);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(localStorage.getItem('active_workspace_id') ?? undefined);
  const [triggerKind, setTriggerKind] = useState<'interval' | 'cron' | 'folder_watch'>('interval');
  const [interval, setIntervalMinutes] = useState(5);
  const [cron, setCron] = useState('0 9 * * *');
  const [folderPath, setFolderPath] = useState('');
  const [folderPattern, setFolderPattern] = useState('*.txt');
  const [prompt, setPrompt] = useState('');

  async function create() {
    if (!name.trim() || !prompt.trim()) return;
    let trigger: AutomationTrigger;
    if (triggerKind === 'folder_watch') trigger = { kind: 'folder_watch', path: folderPath.trim(), pattern: folderPattern.trim() || undefined };
    else trigger = { kind: 'schedule', intervalMinutes: triggerKind === 'interval' ? interval : undefined, cron: triggerKind === 'cron' ? cron : undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    await createAutomation({
      userId,
      workspaceId,
      name,
      trigger,
      taskTemplate: { prompt },
      autonomyMode: 'semi',
      approvalPolicy: { externalSendRequiresApproval: true, destructiveRequiresApproval: true },
    });
    setName('');
    setPrompt('');
    reload();
  }

  async function open(auto: Automation) {
    setSelected(auto);
    setRuns(await listAutomationRuns(auto.id));
  }

  if (selected) {
    return (
      <div>
        <button style={{ ...ghostBtn, marginBottom: 10 }} onClick={() => setSelected(null)}><Icon name="arrowLeft" size={13} /> Back</button>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 14 }}>{selected.name}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>{triggerLabel(selected.trigger)}</div>
            </div>
            <span style={{ color: tone(selected.status), fontSize: 12 }}>{selected.status}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 8 }}>{selected.taskTemplate.prompt}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button style={btn} onClick={() => runAutomation(selected.id, { reason: 'manual_run' }).then(() => open(selected))}>Run now</button>
            <button style={ghostBtn} onClick={() => (selected.enabled ? pauseAutomation(selected.id) : resumeAutomation(selected.id)).then((a) => { if (a) setSelected(a); reload(); })}>{selected.enabled ? 'Pause' : 'Resume'}</button>
            <button style={dangerBtn} onClick={() => deleteAutomation(selected.id).then(() => { setSelected(null); reload(); })}>Delete</button>
          </div>
        </div>
        <div style={labelStyle}>Runs</div>
        {runs.map((r) => (
          <div key={r.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 12 }}>{r.id}</strong>
              <span style={{ color: tone(r.status), fontSize: 11.5 }}>{r.status}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4 }}>{r.startedAt ?? r.completedAt ?? 'not started'}</div>
            {r.error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{r.error}</div>}
            {r.queueItemId && <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4 }}>Queue: {r.queueItemId}</div>}
          </div>
        ))}
        {runs.length === 0 && <Empty text="No runs yet." />}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12 }}>Create recurring, manual, and folder-triggered coworker tasks. External send/delete actions stay approval-gated.</div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(140px, 220px)', gap: 8 }}>
          <div><div style={labelStyle}>Name</div><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops report every 5 minutes" /></div>
          <div><div style={labelStyle}>Workspace</div><WorkspaceSelect userId={userId} value={workspaceId} onChange={setWorkspaceId} /></div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {(['interval', 'cron', 'folder_watch'] as const).map((k) => <button key={k} style={{ ...ghostBtn, ...(triggerKind === k ? { background: 'var(--accent)', color: '#fff' } : {}) }} onClick={() => setTriggerKind(k)}>{k.replace('_', ' ')}</button>)}
        </div>
        {triggerKind === 'interval' && <div style={{ marginTop: 8 }}><div style={labelStyle}>Interval minutes</div><input style={input} type="number" min={1} value={interval} onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value)))} /></div>}
        {triggerKind === 'cron' && <div style={{ marginTop: 8 }}><div style={labelStyle}>Simple cron</div><input style={input} value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" /></div>}
        {triggerKind === 'folder_watch' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8, marginTop: 8 }}>
            <div><div style={labelStyle}>Folder path</div><input style={input} value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="D:\\Invoices" /></div>
            <div><div style={labelStyle}>Pattern</div><input style={input} value={folderPattern} onChange={(e) => setFolderPattern(e.target.value)} placeholder="*.pdf" /></div>
          </div>
        )}
        <div style={{ marginTop: 8 }}><div style={labelStyle}>Task prompt</div><textarea style={{ ...input, minHeight: 62, resize: 'vertical' }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Create/update a local test report, then read it back." /></div>
        <button style={{ ...btn, marginTop: 10 }} onClick={create}>Save automation</button>
      </div>
      {loading && <Empty text="Loading automations..." />}
      {error && <ErrorBox text={error} />}
      {!loading && !error && items.map((a) => (
        <button key={a.id} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(a)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{a.name}</strong>
            <span style={{ color: tone(a.status), fontSize: 11.5 }}>{a.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 4 }}>{triggerLabel(a.trigger)} · next: {a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : 'manual/event'}</div>
          {Boolean(a.metadata?.lastError) && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{String(a.metadata?.lastError)}</div>}
        </button>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No automations yet." />}
    </div>
  );
}

function triggerLabel(trigger: AutomationTrigger): string {
  if (trigger.kind === 'schedule') return trigger.intervalMinutes ? `Every ${trigger.intervalMinutes} minutes` : `Cron ${trigger.cron}`;
  if (trigger.kind === 'folder_watch') return `Folder ${trigger.path} (${trigger.pattern ?? '*'})`;
  return trigger.kind;
}

export function TaskQueueTab({ userId }: { userId: string }) {
  const { items, loading, error, reload } = useLoader<TaskQueueItem>(() => listQueueItems({ userId }), [userId]);
  const [prompt, setPrompt] = useState('');
  async function add() {
    if (!prompt.trim()) return;
    await enqueueTask({ userId, workspaceId: localStorage.getItem('active_workspace_id') ?? undefined, source: 'manual', prompt, priority: 'normal' });
    setPrompt('');
    setTimeout(reload, 250);
  }
  return (
    <div>
      <div style={card}>
        <div style={labelStyle}>Manual queue item</div>
        <textarea style={{ ...input, minHeight: 58, resize: 'vertical', marginTop: 4 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button style={{ ...btn, marginTop: 8 }} onClick={add}>Enqueue</button>
      </div>
      {loading && <Empty text="Loading queue..." />}
      {error && <ErrorBox text={error} />}
      {items.map((item) => (
        <div key={item.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>{item.source} · {item.id}</strong>
            <span style={{ color: tone(item.status), fontSize: 11.5 }}>{item.status}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{item.prompt}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4 }}>{item.progress ?? item.createdAt}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {(item.status === 'queued' || item.status === 'waiting_approval') && <button style={dangerBtn} onClick={() => cancelQueuedTask(item.id).then(reload)}>Cancel</button>}
            {item.status === 'failed' && <button style={ghostBtn} onClick={() => retryQueueItem(item.id).then(reload)}>Retry</button>}
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No queued tasks." />}
    </div>
  );
}

export function NotificationsTab({ userId }: { userId: string }) {
  const { items, loading, error, reload } = useLoader<Notification>(() => listNotifications({ userId }), [userId]);
  return (
    <div>
      {loading && <Empty text="Loading notifications..." />}
      {error && <ErrorBox text={error} />}
      {items.map((n) => (
        <div key={n.id} style={{ ...card, opacity: n.read ? 0.65 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>{n.title}</strong>
            <span style={{ fontSize: 11, color: tone(n.kind) }}>{n.kind}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{n.body}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{new Date(n.createdAt).toLocaleString()}</span>
            {!n.read && <button style={ghostBtn} onClick={() => markRead(n.id).then(reload)}>Mark read</button>}
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No notifications yet." />}
    </div>
  );
}

export function ApprovalInboxTab({ userId }: { userId: string }) {
  const { items, loading, error, reload } = useLoader<ApprovalRequestRecord>(() => listApprovalRequests({ userId }), [userId]);
  async function seed() {
    await createApprovalRequest({
      userId,
      workspaceId: localStorage.getItem('active_workspace_id') ?? undefined,
      actionName: 'connection.external_send',
      risk: 'external_send',
      reason: 'Manual validation request',
      argsSummary: 'Send a test approval payload',
    });
    reload();
  }
  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>Approvals persist here so gateway/mobile users can resolve sensitive actions outside chat.</div>
        <button style={ghostBtn} onClick={seed}>Create test approval</button>
      </div>
      {loading && <Empty text="Loading approvals..." />}
      {error && <ErrorBox text={error} />}
      {items.map((a) => (
        <div key={a.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>{a.actionName}</strong>
            <span style={{ color: tone(a.status), fontSize: 11.5 }}>{a.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 4 }}>Risk: {a.risk}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{a.reason}</div>
          <pre style={{ fontSize: 11, color: 'var(--text-hint)', background: 'var(--bg-input)', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap' }}>{a.argsSummary}</pre>
          {a.status === 'pending' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => resolveApprovalRequest(a.id, 'approved_once').then(reload)}>Allow once</button>
              {!String(a.risk).includes('external_send') && !String(a.risk).includes('destructive') && <button style={ghostBtn} onClick={() => resolveApprovalRequest(a.id, 'approved_always').then(reload)}>Always allow</button>}
              <button style={dangerBtn} onClick={() => resolveApprovalRequest(a.id, 'denied').then(reload)}>Deny</button>
            </div>
          )}
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No approval requests." />}
    </div>
  );
}

export function GatewayTab({ userId }: { userId: string }) {
  const channels = useLoader<GatewayChannel>(() => listGatewayChannels({ userId }), [userId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GatewayMessage[]>([]);
  const [sender, setSender] = useState('local-user');
  const [text, setText] = useState('/task create a test file and verify it');
  const active = channels.items.find((c) => c.id === activeId) ?? channels.items[0];

  useEffect(() => { if (!activeId && channels.items[0]) setActiveId(channels.items[0].id); }, [channels.items, activeId]);
  useEffect(() => { if (active) listGatewayMessages(active.id).then(setMessages); }, [active?.id]);

  async function createLocal() {
    const channel = await createGatewayChannel({
      userId,
      workspaceId: localStorage.getItem('active_workspace_id') ?? undefined,
      displayName: 'Local mock gateway',
      kind: 'local',
      trustedSenderIds: ['local-user'],
    });
    channels.reload();
    setActiveId(channel.id);
  }

  async function send() {
    if (!active || !text.trim()) return;
    const reply = await routeGatewayMessage({ channelId: active.id, sender, text });
    await listGatewayMessages(active.id).then(setMessages);
    setText(reply.startsWith('Task queued') ? '/status ' + reply.replace('Task queued: ', '') : text);
  }

  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>Mock/local gateway is fully functional. Telegram is stubbed in docs; unknown senders are rejected by trustedSenderIds.</div>
        <button style={btn} onClick={createLocal}>Create local channel</button>
      </div>
      {channels.error && <ErrorBox text={channels.error} />}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10 }}>
        <div>
          {channels.items.map((c) => (
            <button key={c.id} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', borderColor: active?.id === c.id ? 'var(--accent)' : 'var(--border-md)' }} onClick={() => setActiveId(c.id)}>
              <strong style={{ fontSize: 12.5 }}>{c.displayName}</strong>
              <div style={{ fontSize: 11, color: tone(c.authStatus), marginTop: 4 }}>{c.kind} · {c.authStatus}</div>
            </button>
          ))}
          {channels.items.length === 0 && <Empty text="No gateway channels." />}
        </div>
        <div>
          {active && (
            <>
              <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 8 }}>
                  <input style={input} value={sender} onChange={(e) => setSender(e.target.value)} />
                  <input style={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button style={btn} onClick={send}>Send</button>
                </div>
              </div>
              {messages.map((m) => (
                <div key={m.id} style={{ ...card, borderLeft: `3px solid ${m.direction === 'inbound' ? 'var(--accent)' : 'var(--success)'}` }}>
                  <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{m.direction} · {m.sender} · {new Date(m.createdAt).toLocaleString()}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{m.text}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
