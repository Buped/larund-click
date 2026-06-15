import { useState, useEffect, useRef } from 'react';
import { Icon, ClickMark } from './icons';
import { getSessions, updateSessionTitle, deleteSession } from '../lib/database';
import type { UserCredits } from '../lib/supabase';

function emailInitials(email: string): string {
  const local = email.split('@')[0];
  const parts = local.split(/[._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

type ChatItem = { id: string; title: string; time: string };

function ChatRow({ chat, active, onSelect, onRename, onDelete }: {
  chat: ChatItem;
  active: boolean;
  onSelect: () => void;
  onRename: (t: string) => void;
  onDelete: () => void;
}) {
  const [hovered,   setHovered  ] = useState(false);
  const [menuOpen,  setMenuOpen ] = useState(false);
  const [renaming,  setRenaming ] = useState(false);
  const [renameVal, setRenameVal] = useState(chat.title);
  const menuRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [menuOpen]);

  function commitRename() {
    const v = renameVal.trim();
    if (v) onRename(v); else setRenameVal(chat.title);
    setRenaming(false);
  }

  const showActions = (hovered || menuOpen) && !renaming;

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        className={`sidebar-row${active ? ' sidebar-row--active' : ''}`}
        title={chat.title}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flex: 'none',
          background: active ? 'var(--accent)' : 'rgba(255,255,255,0.18)',
          transition: 'background .15s',
        }} />

        <span style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <input
              ref={inputRef}
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setRenaming(false); setRenameVal(chat.title); }
              }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', background: 'var(--bg-input)',
                border: '1px solid var(--accent)', borderRadius: 5,
                padding: '2px 6px', fontSize: 12.5,
                color: 'var(--text-primary)', outline: 'none',
                fontFamily: 'inherit', display: 'block',
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
              <span style={{
                fontSize: 13, flex: 1, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: active ? 500 : 400,
                transition: 'color .15s',
              }}>
                {chat.title}
              </span>
              {!showActions && (
                <span style={{ fontSize: 10.5, color: 'var(--text-hint)', flex: 'none' }}>
                  {chat.time}
                </span>
              )}
            </div>
          )}
        </span>

        {showActions && (
          <span
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            style={{
              width: 22, height: 22, borderRadius: 5, flex: 'none',
              display: 'grid', placeItems: 'center',
              background: 'rgba(255,255,255,0.08)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <Icon name="more" size={12} stroke={1.5} />
          </span>
        )}
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="sidebar-row-menu fade-up"
          style={{
            position: 'absolute', top: 'calc(100% - 2px)', right: 4,
            width: 162, background: 'var(--bg-elevated)',
            border: '1px solid var(--border-md)', borderRadius: 10, padding: 4,
            boxShadow: '0 14px 40px rgba(0,0,0,.6)', zIndex: 50,
          }}
        >
          <button
            onClick={() => { setMenuOpen(false); setRenaming(true); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 7, fontSize: 13,
              color: 'var(--text-primary)', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Icon name="pencil" size={13} stroke={1.5} style={{ color: 'var(--text-hint)' }} />
            Rename
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }} />
          <button
            onClick={() => { setMenuOpen(false); onDelete(); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 7, fontSize: 13,
              color: 'var(--danger)', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(229,72,77,.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Icon name="trash" size={13} stroke={1.5} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar({ nav, activeChat, onChatChange, userEmail, refreshKey, credits }: {
  nav: (s: string) => void;
  activeChat: string | null;
  onChatChange: (id: string | null) => void;
  userEmail?: string | null;
  refreshKey?: number;
  credits?: UserCredits | null;
}) {
  const [chats, setChats] = useState<ChatItem[]>([]);

  function loadChats() {
    getSessions().then(rows =>
      setChats(rows.map(r => ({
        id: r.id,
        title: r.title,
        time: timeAgo(r.updated_at),
      })))
    );
  }

  useEffect(() => { loadChats(); }, [refreshKey]);

  async function handleRename(id: string, title: string) {
    await updateSessionTitle(id, title);
    setChats(cs => cs.map(c => c.id === id ? { ...c, title } : c));
  }

  async function handleDelete(id: string) {
    await deleteSession(id);
    setChats(cs => cs.filter(c => c.id !== id));
    if (activeChat === id) onChatChange(null);
  }

  const username = userEmail ? userEmail.split('@')[0] : 'User';
  const isNewChat = activeChat === null;

  const creditPct = credits && credits.monthly_uc_limit > 0
    ? Math.min(100, Math.round((credits.uc_balance / credits.monthly_uc_limit) * 100))
    : null;
  const creditColor = creditPct === null ? 'var(--text-hint)'
    : creditPct >= 60 ? 'var(--success)'
    : creditPct >= 25 ? 'var(--warning)'
    : 'var(--danger)';

  return (
    <aside className="sidebar">

      {/* ── Brand — no + button here ── */}
      <div className="sidebar-brand">
        <ClickMark size={26} radius={8} glow />
        <span className="sidebar-brand-name">Click</span>
      </div>

      {/* ── Chat list ── */}
      <div className="sidebar-body">

        <div className="sidebar-section-hd">
          <span className="sidebar-section-label">Chats</span>
        </div>

        {/* New chat — always visible; click → go to welcome panel */}
        <button
          onClick={() => onChatChange(null)}
          className={`sidebar-new-row${isNewChat ? ' sidebar-new-row--active' : ''}`}
          title="New chat"
        >
          <span style={{
            display: 'grid', placeItems: 'center', flex: 'none',
            color: isNewChat ? 'var(--warning)' : 'var(--text-hint)',
            transition: 'color .15s',
          }}>
            <Icon name="plus" size={12} stroke={2.2} />
          </span>
          <span style={{
            fontSize: 13, fontWeight: isNewChat ? 500 : 400,
            color: isNewChat ? 'var(--text-primary)' : 'var(--text-muted)',
            transition: 'color .15s',
          }}>
            New chat
          </span>
        </button>

        {/* Chat history */}
        <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
          {chats.length === 0 && (
            <div style={{ padding: '12px 10px', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>No chats yet</span>
            </div>
          )}
          {chats.map(chat => (
            <ChatRow
              key={chat.id} chat={chat} active={activeChat === chat.id}
              onSelect={() => onChatChange(chat.id)}
              onRename={title => handleRename(chat.id, title)}
              onDelete={() => handleDelete(chat.id)}
            />
          ))}
        </div>
      </div>

      {/* ── User profile ── */}
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">
          {userEmail ? emailInitials(userEmail) : 'U'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.3,
          }}>
            {username}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>
            Workspace
          </div>
        </div>
        {creditPct !== null ? (
          <div className="credit-pill" style={{ color: creditColor }}>
            <Icon name="battery" size={13} stroke={1.5} />
            <span>{creditPct}%</span>
          </div>
        ) : (
          <span className="dot dot-green dot-pulse" />
        )}
      </div>

      {/* ── Bottom nav ── */}
      <div className="sidebar-footer">
        <button className="sidebar-nav-btn" onClick={() => nav('coworker')} title="Coworker Core">
          <Icon name="grid" size={15} stroke={1.5} style={{ color: 'var(--text-hint)', flex: 'none' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, textAlign: 'left' }}>Coworker</span>
        </button>
        <button className="sidebar-nav-btn" onClick={() => nav('scheduler')} title="Scheduler">
          <Icon name="calendar" size={15} stroke={1.5} style={{ color: 'var(--text-hint)', flex: 'none' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, textAlign: 'left' }}>Scheduler</span>
        </button>
        <button className="sidebar-nav-btn" onClick={() => nav('settings')} title="Settings">
          <Icon name="settings" size={15} stroke={1.5} style={{ color: 'var(--text-hint)', flex: 'none' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, textAlign: 'left' }}>Settings</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)' }}>v1.8.2</span>
        </button>
      </div>

    </aside>
  );
}
