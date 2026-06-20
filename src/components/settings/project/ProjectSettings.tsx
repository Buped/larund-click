// "Current Project" settings area. Operates on the active project resolved by
// App.tsx. Owner-only controls (invite, remove, transfer, archive, edit) are
// hidden for members; members get a "Leave project" action instead.
//
// Shared project data (name, description, settings, workflow definitions) lives
// in the cloud. Personal secrets, memory and chat history are never shared — a
// member running a project workflow uses their own connections.

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../icons';
import type { Project, ProjectInvitation, ProjectMember, ProjectOwnershipTransfer } from '../../../lib/projects/types';
import { updateProject, archiveProject } from '../../../lib/projects/store';
import {
  listProjectMembers,
  listProjectInvitations,
  listProjectOwnershipTransfers,
  inviteProjectMember,
  cancelProjectInvitation,
  removeProjectMember,
  leaveProject,
  requestProjectOwnershipTransfer,
  cancelProjectOwnershipTransfer,
} from '../../../lib/projects/collaboration';

export type ProjectSection = 'overview' | 'members' | 'automations' | 'skills' | 'requirements' | 'danger';

const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
const input: React.CSSProperties = { width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-hint)', marginBottom: 5 };

function Info({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: 'var(--text-hint)', lineHeight: 1.55, padding: '12px 0' }}>{children}</div>;
}

export function ProjectSettings({
  section,
  project,
  userId,
  onProjectsChanged,
}: {
  section: ProjectSection;
  project: Project;
  userId: string;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const isOwner = project.role === 'owner';

  if (section === 'overview') return <Overview project={project} isOwner={isOwner} onProjectsChanged={onProjectsChanged} />;
  if (section === 'members') return <Members project={project} userId={userId} isOwner={isOwner} onProjectsChanged={onProjectsChanged} />;
  if (section === 'danger') return <DangerZone project={project} isOwner={isOwner} onProjectsChanged={onProjectsChanged} />;
  if (section === 'automations') {
    return (
      <Info>
        Automations created here are scoped to <strong>{project.name}</strong> and shared with everyone in the project.
        When a member runs an automation, it uses <strong>their own</strong> connected accounts and credentials — never the owner's.
        {!isOwner && ' Only the owner can change the project automation policy.'}
      </Info>
    );
  }
  if (section === 'skills') {
    return (
      <Info>
        Skills enabled for <strong>{project.name}</strong> are available to all members. Skill definitions are shared;
        any credentials a skill needs are resolved per-user from each member's own connections.
        {!isOwner && ' Only the owner can change which skills are enabled.'}
      </Info>
    );
  }
  if (section === 'requirements') {
    return (
      <Info>
        Connection requirements describe which integrations <strong>{project.name}</strong>'s workflows need (e.g. Google, X).
        Each member connects their own account to satisfy a requirement; nothing is shared between members.
        {!isOwner && ' Only the owner can change the project requirements.'}
      </Info>
    );
  }
  return null;
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ project, isOwner, onProjectsChanged }: { project: Project; isOwner: boolean; onProjectsChanged: () => Promise<void> | void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [showId, setShowId] = useState(false);

  useEffect(() => { setName(project.name); setDescription(project.description); }, [project.id, project.name, project.description]);

  const dirty = name.trim() !== project.name || description !== project.description;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setStatus('');
    try {
      await updateProject(project.id, { name: name.trim() || project.name, description });
      await onProjectsChanged();
      setStatus('Saved.');
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 12 }}>
      <div>
        <div style={label}>Project name</div>
        <input style={input} value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div style={label}>Description</div>
        <textarea
          value={description} disabled={!isOwner} rows={3} onChange={(e) => setDescription(e.target.value)}
          style={{ ...input, resize: 'none', lineHeight: 1.5 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div><div style={label}>Kind</div><div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{project.kind}</div></div>
        <div><div style={label}>Your role</div><div style={{ fontSize: 13, color: isOwner ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'capitalize' }}>{project.role ?? 'member'}</div></div>
      </div>
      {isOwner && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
          {status && <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>{status}</span>}
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button onClick={() => setShowId((v) => !v)} style={{ background: 'none', border: 'none', color: 'var(--text-hint)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {showId ? 'Hide' : 'Show'} advanced
        </button>
        {showId && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>Project ID: {project.id}</div>}
      </div>
    </div>
  );
}

// ── Members ───────────────────────────────────────────────────────────────────

function Members({ project, userId, isOwner, onProjectsChanged }: { project: Project; userId: string; isOwner: boolean; onProjectsChanged: () => Promise<void> | void }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, inv] = await Promise.all([
        listProjectMembers(project.id),
        isOwner ? listProjectInvitations(project.id) : Promise.resolve([] as ProjectInvitation[]),
      ]);
      setMembers(m);
      setInvites(inv);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [project.id, isOwner]);

  useEffect(() => { void reload(); }, [reload]);

  async function invite() {
    const email = inviteEmail.trim();
    if (!email || sending) return;
    setSending(true); setInviteStatus('');
    try {
      await inviteProjectMember(project.id, email, inviteMessage.trim());
      setInviteEmail(''); setInviteMessage('');
      setInviteStatus(`Invitation sent to ${email}.`);
      await reload();
    } catch (e) {
      setInviteStatus(String(e instanceof Error ? e.message : e));
    } finally { setSending(false); }
  }

  async function remove(memberUserId: string) {
    setBusy(memberUserId);
    try { await removeProjectMember(project.id, memberUserId); await reload(); }
    catch (e) { setInviteStatus(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(null); }
  }

  async function cancelInvite(id: string) {
    setBusy(id);
    try { await cancelProjectInvitation(id); await reload(); }
    finally { setBusy(null); }
  }

  async function leave() {
    if (!confirm(`Leave "${project.name}"? You will lose access until invited again.`)) return;
    setBusy('leave');
    try { await leaveProject(project.id); await onProjectsChanged(); }
    catch (e) { setInviteStatus(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12 }}>
      {isOwner && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Invite a member</div>
          <input style={input} placeholder="member@email.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }} />
          <input style={{ ...input, marginTop: 8 }} placeholder="Optional message" value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} disabled={!inviteEmail.trim() || sending} onClick={() => void invite()}>{sending ? 'Sending…' : 'Send invite'}</button>
            {inviteStatus && <span style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{inviteStatus}</span>}
          </div>
        </div>
      )}

      <div>
        <div style={label}>Members</div>
        {loading && <div style={{ fontSize: 12, color: 'var(--text-hint)', padding: 8 }}>Loading…</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.map((m) => (
            <div key={m.userId} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="user" size={14} stroke={1.5} style={{ color: 'var(--text-hint)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email ?? m.userId}{m.userId === userId ? ' (you)' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>Joined {new Date(m.joinedAt).toLocaleDateString()}</div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: m.role === 'owner' ? 'var(--accent)' : 'var(--text-hint)' }}>{m.role}</span>
              {isOwner && m.role !== 'owner' && (
                <button className="btn btn-ghost" style={{ height: 26, fontSize: 11, color: 'var(--danger)' }} disabled={busy === m.userId} onClick={() => void remove(m.userId)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isOwner && invites.length > 0 && (
        <div>
          <div style={label}>Pending invitations</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {invites.map((i) => (
              <div key={i.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="mail" size={14} stroke={1.5} style={{ color: 'var(--text-hint)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{i.invitedEmail}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>Pending · sent {new Date(i.createdAt).toLocaleDateString()}</div>
                </div>
                <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} disabled={busy === i.id} onClick={() => void cancelInvite(i.id)}>Cancel</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isOwner && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button className="btn btn-ghost" style={{ height: 32, fontSize: 12.5, color: 'var(--danger)' }} disabled={busy === 'leave'} onClick={() => void leave()}>Leave project</button>
        </div>
      )}
    </div>
  );
}

// ── Transfer ownership (shared by Danger zone) ───────────────────────────────

function TransferOwnership({ project, onProjectsChanged }: { project: Project; onProjectsChanged: () => Promise<void> | void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<ProjectOwnershipTransfer[]>([]);

  const reload = useCallback(async () => {
    try { setPending(await listProjectOwnershipTransfers(project.id)); } catch { /* ignore */ }
  }, [project.id]);
  useEffect(() => { void reload(); }, [reload]);

  async function send() {
    if (!email.trim() || !confirm || sending) return;
    setSending(true); setStatus('');
    try {
      await requestProjectOwnershipTransfer(project.id, email.trim(), message.trim());
      setEmail(''); setMessage(''); setConfirm(false);
      setStatus('Transfer request sent.');
      await reload();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally { setSending(false); }
  }

  async function cancel(id: string) {
    try { await cancelProjectOwnershipTransfer(id); await reload(); await onProjectsChanged(); } catch { /* ignore */ }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Transfer ownership</div>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', lineHeight: 1.5, marginBottom: 10 }}>
        Transfer ownership gives full control of this project to another user. Your access will be removed unless the new owner invites you back as a member.
      </div>
      <input style={input} placeholder="new-owner@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={{ ...input, marginTop: 8 }} placeholder="Optional message" value={message} onChange={(e) => setMessage(e.target.value)} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ marginTop: 1 }} />
        I understand I may lose access to this project.
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <button className="btn btn-danger" style={{ height: 30, fontSize: 12 }} disabled={!email.trim() || !confirm || sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send transfer request'}</button>
        {status && <span style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{status}</span>}
      </div>
      {pending.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {pending.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-hint)' }}>
              <span style={{ flex: 1 }}>Pending transfer to {t.toEmail} · expires {new Date(t.expiresAt).toLocaleDateString()}</span>
              <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }} onClick={() => void cancel(t.id)}>Cancel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function DangerZone({ project, isOwner, onProjectsChanged }: { project: Project; isOwner: boolean; onProjectsChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function archive() {
    if (!confirm(`Archive "${project.name}"? It will be hidden from everyone.`)) return;
    setBusy(true); setStatus('');
    try { await archiveProject(project.id); await onProjectsChanged(); }
    catch (e) { setStatus(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  async function leave() {
    if (!confirm(`Leave "${project.name}"?`)) return;
    setBusy(true); setStatus('');
    try { await leaveProject(project.id); await onProjectsChanged(); }
    catch (e) { setStatus(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12 }}>
      <div style={{ background: 'rgba(229,72,77,.06)', border: '1px solid rgba(229,72,77,.25)', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#E5484D', marginBottom: 4 }}>Danger zone</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>These actions affect everyone in the project.</div>
      </div>

      {isOwner && <TransferOwnership project={project} onProjectsChanged={onProjectsChanged} />}

      {isOwner ? (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>Archive project</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>Hide this project. No hard delete.</div>
          </div>
          <button className="btn btn-danger" style={{ height: 30, fontSize: 12 }} disabled={busy} onClick={() => void archive()}>Archive</button>
        </div>
      ) : (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>Leave project</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>You will lose access until invited again.</div>
          </div>
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12, color: 'var(--danger)' }} disabled={busy} onClick={() => void leave()}>Leave</button>
        </div>
      )}
      {status && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{status}</div>}
    </div>
  );
}
