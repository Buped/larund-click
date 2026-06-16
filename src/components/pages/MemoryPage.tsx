// Memory — "Larund learns with you". Active memories steer the agent; suggested
// memories are reviewed before they go active; archived ones are kept out of the
// way. This is a product-grade view over the existing memory store, which already
// tracks lifecycle, scope, source, and confidence.

import { useState } from 'react';
import { Icon } from '../icons';
import {
  listMemory, listSuggestions, createMemory, archiveMemory, deleteMemory,
  pinMemory, acceptMemorySuggestion, rejectMemorySuggestion, updateMemory,
} from '../../lib/memory/store';
import type { MemoryEntry, MemoryType, MemoryScope } from '../../lib/memory/types';
import {
  PageFrame, PageHeader, Empty, Loading, ErrorBox, Tabs, SearchInput, Badge,
  card, btn, ghostBtn, dangerBtn, input, statusColor, useAsyncList, getActiveWorkspaceId,
} from './ui';

const TYPES: MemoryType[] = ['preference', 'correction', 'procedural', 'project', 'workspace', 'user_profile', 'evidence', 'episodic'];

function sourceLabel(s: string): string {
  return ({ user: 'Added by you', agent: 'Learned from chat', correction: 'Learned from correction', task: 'Learned from task', document: 'From a document', system: 'System' } as Record<string, string>)[s] ?? s;
}

function AddMemoryForm({ userId, onAdded }: { userId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('preference');
  const [scope, setScope] = useState<MemoryScope>('global');

  async function add() {
    if (!title.trim() || !content.trim()) return;
    await createMemory({ userId, type, title, content, source: 'user', scope, workspaceId: scope === 'workspace' ? getActiveWorkspaceId() : undefined });
    setTitle(''); setContent(''); setOpen(false); onAdded();
  }
  if (!open) return <button style={{ ...btn, marginBottom: 12 }} onClick={() => setOpen(true)}><Icon name="plus" size={13} stroke={2} /> Add memory</button>;
  return (
    <div style={card}>
      <input style={{ ...input, marginBottom: 8 }} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea style={{ ...input, minHeight: 54, resize: 'vertical' }} placeholder="What should Larund remember?" value={content} onChange={(e) => setContent(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select style={{ ...input, width: 150 }} value={type} onChange={(e) => setType(e.target.value as MemoryType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select style={{ ...input, width: 140 }} value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>{(['global', 'workspace', 'project'] as MemoryScope[]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <div style={{ flex: 1 }} />
        <button style={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
        <button style={btn} onClick={add}>Save</button>
      </div>
    </div>
  );
}

function MemoryCard({ m, onChange }: { m: MemoryEntry; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.content);
  async function save() { await updateMemory(m.id, { content: val }); setEditing(false); onChange(); }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {m.pinned && <Icon name="sparkle" size={12} stroke={1.8} style={{ color: 'var(--accent)' }} />}
          <strong style={{ fontSize: 13 }}>{m.title}</strong>
          <Badge text={`${m.type} · ${m.scope}`} />
        </div>
        <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
          <button style={ghostBtn} onClick={() => pinMemory(m.id, !m.pinned).then(onChange)}>{m.pinned ? 'Unpin' : 'Pin'}</button>
          <button style={ghostBtn} onClick={() => setEditing((v) => !v)}>Edit</button>
          {m.status !== 'archived' && <button style={ghostBtn} onClick={() => archiveMemory(m.id).then(onChange)}>Archive</button>}
          <button style={dangerBtn} onClick={() => deleteMemory(m.id).then(onChange)}>Delete</button>
        </div>
      </div>
      {editing
        ? <div style={{ marginTop: 8 }}><textarea style={{ ...input, minHeight: 54 }} value={val} onChange={(e) => setVal(e.target.value)} /><div style={{ marginTop: 6 }}><button style={btn} onClick={save}>Save</button></div></div>
        : <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>{m.content}</div>}
      <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 7 }}>{sourceLabel(m.source)} · confidence {Math.round(m.confidence * 100)}%{m.sensitivity !== 'normal' ? ` · ${m.sensitivity}` : ''}</div>
    </div>
  );
}

type Tab = 'active' | 'suggested' | 'archived';

export function MemoryPage({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const active = useAsyncList<MemoryEntry>(() => listMemory({ userId, status: 'active', query: query || undefined }), [userId, query]);
  const suggested = useAsyncList<MemoryEntry>(() => listSuggestions(userId), [userId]);
  const archived = useAsyncList<MemoryEntry>(() => listMemory({ userId, status: 'archived', includeArchived: true, query: query || undefined }), [userId, query]);

  function reloadAll() { active.reload(); suggested.reload(); archived.reload(); }

  const current = tab === 'active' ? active : tab === 'suggested' ? suggested : archived;

  return (
    <PageFrame>
      <PageHeader title="Memory" subtitle="Things Larund remembers to work better with you." />
      <Tabs<Tab>
        tabs={[
          { id: 'active', label: 'Active', count: active.items.length },
          { id: 'suggested', label: 'Suggested', count: suggested.items.length },
          { id: 'archived', label: 'Archived', count: archived.items.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'active' && <AddMemoryForm userId={userId} onAdded={reloadAll} />}
      {tab !== 'suggested' && <SearchInput value={query} onChange={setQuery} placeholder="Search memories…" />}

      {tab === 'suggested' && suggested.items.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 10 }}>Larund noticed these from your chats and tasks. Accept to make them active, or reject.</div>
      )}

      {current.loading && <Loading />}
      {current.error && <ErrorBox text={current.error} />}

      {tab === 'suggested'
        ? suggested.items.map((s) => (
            <div key={s.id} style={{ ...card, borderColor: 'var(--warning)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 12.5 }}>{s.title}</strong>
                <Badge text={`${s.type}`} color={statusColor(s.status)} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.content}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 6 }}>{sourceLabel(s.source)}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => acceptMemorySuggestion(s.id).then(reloadAll)}>Save</button>
                <button style={dangerBtn} onClick={() => rejectMemorySuggestion(s.id, true).then(reloadAll)}>Not now</button>
              </div>
            </div>
          ))
        : current.items.map((m) => <MemoryCard key={m.id} m={m} onChange={reloadAll} />)}

      {!current.loading && current.items.length === 0 && (
        <Empty
          text={tab === 'active' ? 'No active memories yet. Larund will suggest some as you work.' : tab === 'suggested' ? 'No suggestions to review.' : 'Nothing archived.'}
          icon="cpu"
        />
      )}
    </PageFrame>
  );
}
