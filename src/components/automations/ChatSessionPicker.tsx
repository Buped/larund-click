// Searchable modal for attaching an automation to an existing chat. Reuses the
// existing sessions table via getSessions — no new chat data model.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { getSessions } from '../../lib/database';
import { btn, ghostBtn, card } from '../pages/ui';

type SessionRow = { id: string; title: string; updated_at?: string; project_id?: string | null };

export function ChatSessionPicker({ projectId, onCancel, onSelect }: {
  projectId?: string | null;
  onCancel: () => void;
  onSelect: (selected: { sessionId: string; title: string }) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Pull both the project-scoped chats and any legacy/global ones so nothing
      // the user might want to attach is hidden.
      const [scoped, global] = await Promise.all([
        projectId ? getSessions(projectId).catch(() => []) : Promise.resolve([]),
        getSessions(null).catch(() => []),
      ]);
      const merged = new Map<string, SessionRow>();
      for (const row of [...scoped, ...global] as SessionRow[]) merged.set(row.id, row);
      if (alive) {
        setSessions([...merged.values()].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q));
  }, [sessions, query]);

  const chosen = filtered.find((s) => s.id === selected) ?? sessions.find((s) => s.id === selected);

  return (
    <div style={backdropStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Attach an existing chat</h2>
          <button style={ghostBtn} onClick={onCancel} title="Close"><Icon name="x" size={13} /></button>
        </div>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            autoFocus
            style={{ width: '100%', background: 'var(--bg-field)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13 }}
          />
        </div>
        <div style={{ maxHeight: '48vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && <div style={{ ...card, color: 'var(--text-hint)', fontSize: 12.5 }}>Loading chats…</div>}
          {!loading && filtered.length === 0 && <div style={{ ...card, color: 'var(--text-hint)', fontSize: 12.5 }}>No chats found.</div>}
          {filtered.map((s) => {
            const isSel = selected === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: isSel ? 'rgba(74,158,255,.12)' : 'rgba(var(--ov-color),.03)', border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '9px 11px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="message" size={13} stroke={1.7} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled chat'}</span>
                  {s.project_id == null && <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>global</span>}
                </div>
                {s.updated_at && <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 3 }}>Updated {new Date(s.updated_at).toLocaleString()}</div>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={ghostBtn} onClick={onCancel}>Cancel</button>
          <button style={btn} disabled={!chosen} onClick={() => chosen && onSelect({ sessionId: chosen.id, title: chosen.title || 'Untitled chat' })}>Use selected chat</button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 160, display: 'grid', placeItems: 'center', padding: 22,
};
const modalStyle: React.CSSProperties = {
  width: 'min(560px, 100%)', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 28px 90px rgba(0,0,0,.45)', padding: 18,
};
