// Memory — "Larund learns with you". Active memories steer the agent; suggested
// memories are reviewed before they go active; daily summaries compress each day;
// archived ones are kept out of the way. Product-grade view over the memory store
// (lifecycle, scope, source, confidence, provenance, merge/supersede).

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import {
  listMemory, listSuggestions, createMemory, archiveMemory, deleteMemory,
  pinMemory, acceptMemorySuggestion, rejectMemorySuggestion, updateMemory,
  exportMemory, detectDuplicates, mergeMemories,
} from '../../lib/memory/store';
import { generateDailySummary, localDateKey } from '../../lib/memory/daily-summary';
import type { MemoryEntry, MemoryType, MemoryScope, MemorySource } from '../../lib/memory/types';
import {
  PageFrame, PageHeader, Empty, Loading, ErrorBox, Tabs, SearchInput, Badge,
  card, btn, ghostBtn, dangerBtn, input, statusColor, useAsyncList, getActiveWorkspaceId,
} from './ui';

const TYPES: MemoryType[] = ['preference', 'correction', 'procedural', 'project', 'client_profile', 'workspace', 'user_profile', 'evidence', 'episodic', 'sensitive_reference'];
const SOURCES: MemorySource[] = ['user', 'agent', 'task', 'correction', 'document', 'system'];

function sourceLabel(s: string): string {
  return ({ user: 'Added by you', agent: 'Learned from chat', correction: 'Learned from correction', task: 'Learned from task', document: 'From a document', system: 'System' } as Record<string, string>)[s] ?? s;
}

function typeColor(t: MemoryType): string {
  if (t === 'correction') return 'var(--danger)';
  if (t === 'sensitive_reference') return 'var(--warning)';
  if (t === 'client_profile' || t === 'project') return 'var(--accent)';
  return 'var(--text-hint)';
}

function rationaleOf(m: MemoryEntry): string | undefined {
  const r = (m.metadata as { rationale?: string } | undefined)?.rationale;
  return typeof r === 'string' ? r : undefined;
}

function timeAgo(iso?: string): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ── Add memory ────────────────────────────────────────────────────────────────

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
  if (!open) return <button style={{ ...ghostBtn, marginBottom: 12 }} onClick={() => setOpen(true)}><Icon name="plus" size={13} stroke={2} /> Add memory</button>;
  return (
    <div style={card}>
      <input style={{ ...input, marginBottom: 8 }} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea style={{ ...input, minHeight: 54, resize: 'vertical' }} placeholder="What should Larund remember?" value={content} onChange={(e) => setContent(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select style={{ ...input, width: 160 }} value={type} onChange={(e) => setType(e.target.value as MemoryType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select style={{ ...input, width: 140 }} value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>{(['global', 'workspace', 'project'] as MemoryScope[]).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <div style={{ flex: 1 }} />
        <button style={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
        <button style={btn} onClick={add}>Save</button>
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function DetailModal({ m, onChange, onClose }: { m: MemoryEntry; onChange: () => void; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.content);
  const [titleVal, setTitleVal] = useState(m.title);
  async function save() { await updateMemory(m.id, { title: titleVal, content: val }); setEditing(false); onChange(); }
  const reason = rationaleOf(m);

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 560, maxWidth: '100%', maxHeight: '86vh', overflow: 'auto', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {m.pinned && <Icon name="sparkle" size={13} stroke={1.8} style={{ color: 'var(--accent)' }} />}
            {editing
              ? <input style={{ ...input }} value={titleVal} onChange={(e) => setTitleVal(e.target.value)} />
              : <strong style={{ fontSize: 14 }}>{m.title}</strong>}
          </div>
          <button style={ghostBtn} onClick={onClose}><Icon name="x" size={12} stroke={2} /></button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Badge text={m.type} color={typeColor(m.type)} />
          <Badge text={m.scope} />
          <Badge text={m.status} color={statusColor(m.status)} />
          {m.sensitivity !== 'normal' && <Badge text={m.sensitivity} color="var(--warning)" />}
          <Badge text={`confidence ${Math.round(m.confidence * 100)}%`} />
        </div>

        {editing
          ? <textarea style={{ ...input, minHeight: 120 }} value={val} onChange={(e) => setVal(e.target.value)} />
          : <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</div>}

        {reason && !editing && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(74,158,255,.06)', border: '1px solid rgba(74,158,255,.18)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Why saved</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{reason}</div>
          </div>
        )}

        {m.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
            {m.tags.map((t) => <span key={t} style={{ fontSize: 10.5, color: 'var(--text-hint)', background: 'rgba(255,255,255,.05)', borderRadius: 5, padding: '2px 6px' }}>#{t}</span>)}
          </div>
        )}

        {/* Provenance */}
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.7 }}>
          <div>Source: {sourceLabel(m.source)}</div>
          <div>Created {timeAgo(m.createdAt)} · Updated {timeAgo(m.updatedAt)} · Used {timeAgo(m.lastUsedAt)}</div>
          {m.sourceTaskRunId && <div>From task run: {m.sourceTaskRunId}</div>}
          {m.supersedesId && <div>Supersedes: {m.supersedesId}</div>}
          {m.contradictsId && <div style={{ color: 'var(--danger)' }}>Contradicts: {m.contradictsId}</div>}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
          {editing
            ? <><button style={btn} onClick={save}>Save</button><button style={ghostBtn} onClick={() => setEditing(false)}>Cancel</button></>
            : <button style={ghostBtn} onClick={() => setEditing(true)}><Icon name="pencil" size={12} stroke={1.7} /> Edit</button>}
          <button style={ghostBtn} onClick={() => pinMemory(m.id, !m.pinned).then(onChange)}>{m.pinned ? 'Unpin' : 'Pin'}</button>
          {m.status !== 'archived' && <button style={ghostBtn} onClick={() => archiveMemory(m.id).then(() => { onChange(); onClose(); })}>Archive</button>}
          <div style={{ flex: 1 }} />
          <button style={dangerBtn} onClick={() => deleteMemory(m.id).then(() => { onChange(); onClose(); })}><Icon name="trash" size={12} stroke={1.7} /> Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function MemoryCard({ m, onOpen }: { m: MemoryEntry; onOpen: () => void }) {
  return (
    <button onClick={onOpen} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {m.pinned && <Icon name="sparkle" size={12} stroke={1.8} style={{ color: 'var(--accent)' }} />}
          <strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</strong>
        </div>
        <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
          <Badge text={m.type} color={typeColor(m.type)} />
          <Badge text={m.scope} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.content}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 7 }}>{sourceLabel(m.source)} · {Math.round(m.confidence * 100)}% · used {timeAgo(m.lastUsedAt)}{m.sensitivity !== 'normal' ? ` · ${m.sensitivity}` : ''}</div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'active' | 'suggested' | 'summaries' | 'archived';

export function MemoryPage({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryType | ''>('');
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | ''>('');
  const [sourceFilter, setSourceFilter] = useState<MemorySource | ''>('');
  const [detail, setDetail] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const filters = { type: typeFilter || undefined, scope: scopeFilter || undefined, source: sourceFilter || undefined, query: query || undefined };

  const active = useAsyncList<MemoryEntry>(() => listMemory({ userId, status: 'active', ...filters }), [userId, query, typeFilter, scopeFilter, sourceFilter]);
  const suggested = useAsyncList<MemoryEntry>(() => listSuggestions(userId), [userId]);
  const summaries = useAsyncList<MemoryEntry>(() => listMemory({ userId, type: 'episodic', status: ['active', 'suggested'], query: query || undefined }), [userId, query]);
  const archived = useAsyncList<MemoryEntry>(() => listMemory({ userId, status: 'archived', includeArchived: true, ...filters }), [userId, query, typeFilter, scopeFilter, sourceFilter]);

  function reloadAll() { active.reload(); suggested.reload(); summaries.reload(); archived.reload(); }

  async function handleSummarizeToday() {
    setBusy('summary');
    try {
      const res = await generateDailySummary(userId, localDateKey(), { workspaceId: getActiveWorkspaceId(), force: true });
      reloadAll();
      if (res.created) setTab('summaries');
    } finally { setBusy(null); }
  }

  async function handleExport() {
    const json = await exportMemory(userId);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `larund-memory-${localDateKey()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleMergeDuplicates() {
    setBusy('merge');
    try {
      const groups = await detectDuplicates(userId, { workspaceId: getActiveWorkspaceId() });
      for (const g of groups) {
        const [target, ...rest] = g;
        await mergeMemories(target.id, rest.map((r) => r.id));
      }
      reloadAll();
    } finally { setBusy(null); }
  }

  const current = tab === 'active' ? active : tab === 'suggested' ? suggested : tab === 'summaries' ? summaries : archived;

  return (
    <PageFrame>
      <PageHeader
        title="Memory"
        subtitle="Things Larund remembers to work better with you. Private and local — never shared."
        actions={
          <>
            <button style={ghostBtn} onClick={handleSummarizeToday} disabled={busy === 'summary'}>
              <Icon name="clock" size={13} stroke={1.7} /> {busy === 'summary' ? 'Summarizing…' : 'Summarize today'}
            </button>
            <button style={ghostBtn} onClick={handleExport}><Icon name="download" size={13} stroke={1.7} /> Export</button>
          </>
        }
      />
      <Tabs<Tab>
        tabs={[
          { id: 'active', label: 'Active', count: active.items.length },
          { id: 'suggested', label: 'Suggested', count: suggested.items.length },
          { id: 'summaries', label: 'Daily summaries', count: summaries.items.length },
          { id: 'archived', label: 'Archived', count: archived.items.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'active' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <AddMemoryForm userId={userId} onAdded={reloadAll} />
          <div style={{ flex: 1 }} />
          <button style={ghostBtn} onClick={handleMergeDuplicates} disabled={busy === 'merge'}>{busy === 'merge' ? 'Merging…' : 'Merge duplicates'}</button>
        </div>
      )}

      {(tab === 'active' || tab === 'archived') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select style={{ ...input, width: 160 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MemoryType | '')}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select style={{ ...input, width: 140 }} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as MemoryScope | '')}>
            <option value="">All scopes</option>
            {(['global', 'workspace', 'project', 'skill'] as MemoryScope[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={{ ...input, width: 150 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as MemorySource | '')}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
          </select>
        </div>
      )}

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
                <Badge text={s.type} color={typeColor(s.type)} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{s.content}</div>
              {rationaleOf(s) && <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 6, fontStyle: 'italic' }}>{rationaleOf(s)}</div>}
              <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 6 }}>{sourceLabel(s.source)}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => acceptMemorySuggestion(s.id).then(reloadAll)}>Save</button>
                <button style={dangerBtn} onClick={() => rejectMemorySuggestion(s.id, true).then(reloadAll)}>Not now</button>
              </div>
            </div>
          ))
        : current.items.map((m) => <MemoryCard key={m.id} m={m} onOpen={() => setDetail(m)} />)}

      {!current.loading && current.items.length === 0 && (
        <Empty
          text={
            tab === 'active' ? 'No active memories yet. Larund will suggest some as you work.'
            : tab === 'suggested' ? 'No suggestions to review.'
            : tab === 'summaries' ? 'No daily summaries yet. Use “Summarize today” or let the nightly job run.'
            : 'Nothing archived.'
          }
          icon="cpu"
        />
      )}

      {detail && <DetailModal m={detail} onChange={() => { reloadAll(); }} onClose={() => setDetail(null)} />}
    </PageFrame>
  );
}
