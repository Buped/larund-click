// Global left navigation rail for the redesigned Larund product. Replaces the
// old "Coworker Core" mega-panel + scattered footer buttons with eight clear
// destinations, a workspace selector, and a lightweight notification inbox.
// Internal/developer surfaces (gateway, custom API, catalog, mock MCP, sandbox,
// audit) are not here — they live under Settings, gated by Developer Mode.

import { useEffect, useRef, useState } from 'react';
import { Icon, ClickMark } from './icons';
import { listWorkspaces, getDefaultWorkspace, createWorkspace } from '../lib/workspaces/store';
import type { Workspace } from '../lib/workspaces/types';
import { listNotifications, markRead } from '../lib/notifications/store';
import type { Notification } from '../lib/notifications/types';

export type Route = 'chat' | 'tasks' | 'automations' | 'skills' | 'memory' | 'connections' | 'mcp';

const NAV: Array<{ id: Route; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: 'message' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'automations', label: 'Automations', icon: 'zap' },
  { id: 'skills', label: 'Skills', icon: 'sparkle' },
  { id: 'memory', label: 'Memory', icon: 'cpu' },
  { id: 'connections', label: 'Connections', icon: 'link' },
  { id: 'mcp', label: 'MCP', icon: 'diamond' },
];

function emailInitials(email: string): string {
  const local = email.split('@')[0];
  const parts = local.split(/[._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function NewWorkspaceModal({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 200, background: 'rgba(0,0,0,.6)' }}>
      <div className="modal-pop" style={{ width: 360, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>New workspace</div>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim()); if (e.key === 'Escape') onClose(); }}
          placeholder="e.g. Marketing Client"
          style={{ width: '100%', background: 'rgba(10,10,8,0.46)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create</button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceSelector({ userId }: { userId: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(localStorage.getItem('active_workspace_id'));
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    let list = await listWorkspaces(userId);
    if (list.length === 0) {
      // Guarantee a default workspace exists so users never see an empty selector.
      await getDefaultWorkspace(userId);
      list = await listWorkspaces(userId);
    }
    setWorkspaces(list);
    const stored = localStorage.getItem('active_workspace_id');
    if (!stored && list[0]) {
      localStorage.setItem('active_workspace_id', list[0].id);
      setActiveId(list[0].id);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  function pick(id: string) {
    localStorage.setItem('active_workspace_id', id);
    setActiveId(id);
    setOpen(false);
  }

  async function addWorkspace(name: string) {
    setCreating(false);
    const ws = await createWorkspace({ userId, name, kind: 'project' });
    await load();
    pick(ws.id);
  }

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  return (
    <div ref={ref} style={{ position: 'relative', padding: '0 10px 10px' }}>
      <button onClick={() => setOpen((v) => !v)} className="nav-ws-btn" title="Switch workspace">
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(74,158,255,0.16)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Icon name="folder" size={12} stroke={1.7} style={{ color: 'var(--accent)' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{active?.name ?? 'Workspace'}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{active?.kind ?? 'workspace'}</span>
        </span>
        <Icon name="chevronDown" size={11} stroke={1.6} style={{ color: 'var(--text-hint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div className="fade-up" style={{ position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 60, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 10, padding: 4, boxShadow: '0 16px 40px rgba(0,0,0,.6)' }}>
          {workspaces.map((w) => (
            <button key={w.id} onClick={() => pick(w.id)} className="nav-ws-item" style={{ color: w.id === active?.id ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              <Icon name={w.id === active?.id ? 'check' : 'folder'} size={12} stroke={1.7} style={{ color: w.id === active?.id ? 'var(--accent)' : 'var(--text-hint)' }} />
              <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '3px 4px' }} />
          <button onClick={() => { setOpen(false); setCreating(true); }} className="nav-ws-item" style={{ color: 'var(--text-muted)' }}>
            <Icon name="plus" size={12} stroke={2} style={{ color: 'var(--text-hint)' }} /> New workspace
          </button>
        </div>
      )}
      {creating && <NewWorkspaceModal onCreate={addWorkspace} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try { setItems(await listNotifications({ userId })); } catch { /* ignore */ }
  }
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t); /* eslint-disable-next-line */ }, [userId]);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  async function markAllRead() {
    await Promise.all(items.filter((n) => !n.read).map((n) => markRead(n.id)));
    load();
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="nav-icon-btn" onClick={() => { setOpen((v) => !v); if (!open) load(); }} title="Notifications">
        <Icon name="alert" size={16} stroke={1.6} />
        {unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="fade-up" style={{ position: 'absolute', bottom: 0, left: 'calc(100% + 8px)', width: 320, maxHeight: 400, overflow: 'auto', zIndex: 70, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 12, padding: 8, boxShadow: '0 20px 50px rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 8px' }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Notifications</strong>
            {unread > 0 && <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Mark all read</button>}
          </div>
          {items.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-hint)', fontSize: 12 }}>You're all caught up.</div>}
          {items.slice(0, 30).map((n) => (
            <div key={n.id} style={{ padding: '8px 8px', borderRadius: 8, opacity: n.read ? 0.6 : 1, borderLeft: n.read ? '2px solid transparent' : '2px solid var(--accent)', marginBottom: 2 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 3 }}>{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavRail({ route, onNavigate, onOpenSettings, userId, userEmail }: {
  route: Route;
  onNavigate: (r: Route) => void;
  onOpenSettings: () => void;
  userId: string;
  userEmail?: string | null;
}) {
  return (
    <nav className="nav-rail">
      <div className="nav-brand">
        <ClickMark size={26} radius={8} glow />
        <span className="nav-brand-name">Larund</span>
      </div>

      <WorkspaceSelector userId={userId} />

      <div className="nav-items">
        {NAV.map((item) => (
          <button key={item.id} className={`nav-item${route === item.id ? ' nav-item--active' : ''}`} onClick={() => onNavigate(item.id)} title={item.label}>
            <Icon name={item.icon} size={16} stroke={1.6} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-footer">
        <NotificationBell userId={userId} />
        <button className="nav-icon-btn" onClick={onOpenSettings} title="Settings">
          <Icon name="settings" size={16} stroke={1.6} />
        </button>
        <div style={{ flex: 1 }} />
        <div className="nav-avatar" title={userEmail ?? 'Account'}>{userEmail ? emailInitials(userEmail) : 'U'}</div>
      </div>
    </nav>
  );
}
