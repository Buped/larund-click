// Global left navigation rail for the redesigned Larund product. Replaces the
// old "Coworker Core" mega-panel + scattered footer buttons with eight clear
// destinations, a project selector, and a lightweight notification inbox.
// Internal/developer surfaces (gateway, custom API, catalog, mock MCP, sandbox,
// audit) are not here — they live under Settings, gated by Developer Mode.

import { useEffect, useRef, useState } from 'react';
import { Icon, ClickMark } from './icons';
import type { Project } from '../lib/projects/types';
import {
  listCloudNotifications,
  markCloudRead,
  markAllCloudRead,
  type CloudNotification,
} from '../lib/notifications/cloud';
import {
  acceptProjectInvitation,
  declineProjectInvitation,
  acceptProjectOwnershipTransfer,
  declineProjectOwnershipTransfer,
} from '../lib/projects/collaboration';

export type Route = 'chat' | 'tasks' | 'automations' | 'skills' | 'memory' | 'connections' | 'logins' | 'mcp';

const NAV: Array<{ id: Route; label: string; icon: string; adminOnly?: boolean }> = [
  { id: 'chat', label: 'Chat', icon: 'message' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'automations', label: 'Automations', icon: 'zap', adminOnly: true },
  { id: 'skills', label: 'Skills', icon: 'sparkle' },
  { id: 'memory', label: 'Memory', icon: 'cpu' },
  { id: 'connections', label: 'Connections', icon: 'link' },
  { id: 'logins', label: 'Apps', icon: 'lock' },
  { id: 'mcp', label: 'MCP', icon: 'diamond' },
];

function emailInitials(email: string): string {
  const local = email.split('@')[0];
  const parts = local.split(/[._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function NewProjectModal({ onCreate, onClose }: { onCreate: (name: string) => Promise<void> | void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onCreate(name.trim());
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 200, background: 'rgba(0,0,0,.6)' }}>
      <div className="modal-pop" style={{ width: 360, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>New project</div>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onClose(); }}
          placeholder="e.g. Marketing Client"
          style={{ width: '100%', background: 'var(--bg-field)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
        />
        {error && <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} disabled={!name.trim() || saving} onClick={submit}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: 'owner' | 'member' }) {
  const owner = role === 'owner';
  return (
    <span
      style={{
        flex: 'none',
        fontSize: 9.5,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '.05em',
        padding: '2px 6px',
        borderRadius: 5,
        color: owner ? 'var(--accent)' : 'var(--text-hint)',
        background: owner ? 'rgba(74,158,255,0.14)' : 'rgba(var(--ov-color),0.06)',
      }}
    >
      {owner ? 'Owner' : 'Member'}
    </span>
  );
}

function ProjectSelector({
  projects,
  activeProject,
  loadingProjects,
  onRefreshProjects,
  onCreateProject,
  onSwitchProject,
}: {
  projects: Project[];
  activeProject: Project | null;
  loadingProjects?: boolean;
  onRefreshProjects: () => Promise<void> | void;
  onCreateProject: (name: string) => Promise<void>;
  onSwitchProject: (projectId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  async function refreshDropdown() {
    setLoadError('');
    try {
      await onRefreshProjects();
    } catch (err) {
      setLoadError(`Could not load projects: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshDropdown();
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function pick(projectId: string) {
    if (projectId === activeProject?.id) {
      setOpen(false);
      return;
    }
    setSwitchingId(projectId);
    setLoadError('');
    try {
      await onSwitchProject(projectId);
      setOpen(false);
    } catch (err) {
      setLoadError(`Could not switch project: ${String(err instanceof Error ? err.message : err)}`);
    } finally {
      setSwitchingId(null);
    }
  }

  async function create(name: string) {
    setLoadError('');
    await onCreateProject(name);
    await refreshDropdown();
  }

  return (
    <div ref={ref} style={{ position: 'relative', padding: '0 10px 10px' }}>
      <button onClick={() => setOpen((v) => !v)} className="nav-ws-btn" title="Switch project">
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(74,158,255,0.16)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Icon name={activeProject?.icon ?? 'folder'} size={12} stroke={1.7} style={{ color: 'var(--accent)' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeProject?.name ?? 'Project'}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{activeProject?.kind ?? 'project'}</span>
        </span>
        <Icon name="chevronDown" size={11} stroke={1.6} style={{ color: 'var(--text-hint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div className="fade-up" style={{ position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 60, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 10, padding: 4, boxShadow: '0 16px 40px rgba(0,0,0,.6)' }}>
          {loadingProjects && projects.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--text-hint)', fontSize: 12 }}>Loading projects...</div>
          )}
          {!loadingProjects && projects.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--text-hint)', fontSize: 12 }}>No projects yet.</div>
          )}
          {loadError && (
            <div style={{ padding: '8px 10px', color: 'var(--danger)', fontSize: 12, lineHeight: 1.4 }}>{loadError}</div>
          )}
          {projects.map((p) => (
            <button key={p.id} onClick={() => void pick(p.id)} className="nav-ws-item" style={{ color: p.id === activeProject?.id ? 'var(--text-primary)' : 'var(--text-muted)' }} disabled={switchingId === p.id}>
              <Icon name={p.id === activeProject?.id ? 'check' : p.icon ?? 'folder'} size={12} stroke={1.7} style={{ color: p.id === activeProject?.id ? 'var(--accent)' : 'var(--text-hint)' }} />
              <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{p.kind}</span>
              </span>
              {p.role && <RoleBadge role={p.role} />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '3px 4px' }} />
          <button onClick={() => { setOpen(false); setCreating(true); }} className="nav-ws-item" style={{ color: 'var(--text-muted)' }}>
            <Icon name="plus" size={12} stroke={2} style={{ color: 'var(--text-hint)' }} /> New project
          </button>
        </div>
      )}
      {creating && <NewProjectModal onCreate={create} onClose={() => setCreating(false)} />}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationBell({
  onProjectsChanged,
  onActivateProject,
}: {
  onProjectsChanged?: () => Promise<void> | void;
  onActivateProject?: (projectId: string) => Promise<void> | void;
}) {
  const [items, setItems] = useState<CloudNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setItems(await listCloudNotifications(50));
    } catch { /* offline / not configured — ignore */ }
  }
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const unread = items.filter((n) => !n.readAt).length;

  async function markAll() {
    await markAllCloudRead().catch(() => {});
    await load();
  }

  async function act(n: CloudNotification, action: 'accept' | 'decline') {
    setBusy(n.id);
    setError('');
    try {
      if (n.type === 'project_invitation_received') {
        const invitationId = String(n.payload.invitation_id ?? '');
        if (action === 'accept') await acceptProjectInvitation(invitationId);
        else await declineProjectInvitation(invitationId);
        if (action === 'accept') await onProjectsChanged?.();
      } else if (n.type === 'project_ownership_transfer_received') {
        const requestId = String(n.payload.request_id ?? '');
        if (action === 'accept') {
          await acceptProjectOwnershipTransfer(requestId);
          const projectId = String(n.payload.project_id ?? '');
          await onProjectsChanged?.();
          if (projectId) await onActivateProject?.(projectId);
        } else {
          await declineProjectOwnershipTransfer(requestId);
        }
      }
      await markCloudRead(n.id).catch(() => {});
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  function actionable(n: CloudNotification): boolean {
    return !n.readAt && (n.type === 'project_invitation_received' || n.type === 'project_ownership_transfer_received');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="nav-icon-btn" onClick={() => { setOpen((v) => !v); if (!open) void load(); }} title="Notifications">
        <Icon name="alert" size={16} stroke={1.6} />
        {unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div
          className="fade-up"
          style={{
            position: 'absolute', bottom: 0, left: 'calc(100% + 8px)',
            width: 360, maxHeight: 460, display: 'flex', flexDirection: 'column',
            zIndex: 70, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)',
            borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,.6)', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>Notifications</strong>
            {unread > 0 && <button onClick={() => void markAll()} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>Mark all read</button>}
          </div>
          {error && <div style={{ padding: '8px 14px', color: 'var(--danger)', fontSize: 11.5, lineHeight: 1.4 }}>{error}</div>}
          <div className="scroll" style={{ overflowY: 'auto', padding: 6 }}>
            {items.length === 0 && <div style={{ padding: '28px 24px', textAlign: 'center', color: 'var(--text-hint)', fontSize: 12 }}>You're all caught up.</div>}
            {items.map((n) => (
              <div
                key={n.id}
                onClick={() => { if (!n.readAt && !actionable(n)) void markCloudRead(n.id).then(load); }}
                onMouseEnter={(e) => { if (!actionable(n)) e.currentTarget.style.background = n.readAt ? 'rgba(var(--ov-color),0.03)' : 'rgba(74,158,255,0.10)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = n.readAt ? 'transparent' : 'rgba(74,158,255,0.07)'; }}
                style={{
                  padding: '11px 12px', borderRadius: 10, marginBottom: 2, position: 'relative',
                  background: n.readAt ? 'transparent' : 'rgba(74,158,255,0.07)',
                  transition: 'background .12s',
                  cursor: !n.readAt && !actionable(n) ? 'pointer' : 'default',
                }}
              >
                {!n.readAt && <span style={{ position: 'absolute', top: 14, right: 11, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', paddingRight: 16 }}>{n.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{n.body}</div>
                {actionable(n) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                    <button className="btn btn-primary" style={{ height: 28, fontSize: 11.5 }} disabled={busy === n.id} onClick={() => void act(n, 'accept')}>
                      {n.type === 'project_ownership_transfer_received' ? 'Accept ownership' : 'Accept'}
                    </button>
                    <button className="btn btn-ghost" style={{ height: 28, fontSize: 11.5 }} disabled={busy === n.id} onClick={() => void act(n, 'decline')}>Decline</button>
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 5 }}>{relativeTime(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NavRail({
  route,
  onNavigate,
  onOpenSettings,
  userEmail,
  isAdmin = false,
  projects,
  activeProject,
  loadingProjects,
  onRefreshProjects,
  onCreateProject,
  onSwitchProject,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
  onOpenSettings: () => void;
  userId: string;
  userEmail?: string | null;
  /** Verified admin status from Supabase. Gates admin-only navigation entirely. */
  isAdmin?: boolean;
  projects: Project[];
  activeProject: Project | null;
  loadingProjects?: boolean;
  onRefreshProjects: () => Promise<void> | void;
  onCreateProject: (name: string) => Promise<void>;
  onSwitchProject: (projectId: string) => Promise<void>;
}) {
  return (
    <nav className="nav-rail">
      <div className="nav-brand">
        <ClickMark size={26} radius={8} glow />
        <span className="nav-brand-name">Larund</span>
      </div>

      <ProjectSelector
        projects={projects}
        activeProject={activeProject}
        loadingProjects={loadingProjects}
        onRefreshProjects={onRefreshProjects}
        onCreateProject={onCreateProject}
        onSwitchProject={onSwitchProject}
      />

      <div className="nav-items">
        {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
          <button key={item.id} className={`nav-item${route === item.id ? ' nav-item--active' : ''}`} onClick={() => onNavigate(item.id)} title={item.label}>
            <Icon name={item.icon} size={16} stroke={1.6} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-footer">
        {/* Admin-only: opens the developer/admin surfaces in Settings. Completely
            absent for non-admins (not just disabled). */}
        {isAdmin && (
          <button className="nav-icon-btn" onClick={onOpenSettings} title="Admin">
            <Icon name="shield" size={16} stroke={1.6} style={{ color: 'var(--accent)' }} />
          </button>
        )}
        <NotificationBell onProjectsChanged={onRefreshProjects} onActivateProject={onSwitchProject} />
        <button className="nav-icon-btn" onClick={onOpenSettings} title="Settings">
          <Icon name="settings" size={16} stroke={1.6} />
        </button>
        <div style={{ flex: 1 }} />
        <div className="nav-avatar" title={userEmail ?? 'Account'}>{userEmail ? emailInitials(userEmail) : 'U'}</div>
      </div>
    </nav>
  );
}
