// Email — a dedicated inbox / correspondence surface for the connected Google
// account. It drives the existing Gmail tools (search, read_thread, modify_labels,
// create_reply_draft, send, list_labels) through the per-user connection registry,
// and reuses the chat EmailComposerCard for new mail. AI triage (categorize +
// summarize + suggest labels) runs read-only; applying labels is an explicit click.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { PageFrame, PageHeader, Empty, btn, ghostBtn, card, input } from './ui';
import { createConnectionRegistry, providerRuntimeState } from '../../lib/connections/registry';
import { beginOAuthConnect } from '../../lib/connections/oauth/connect';
import { EmailComposerCard } from '../email/EmailComposerCard';
import type { EmailDraft } from '../../lib/email/types';
import { newEmailDraftId } from '../../lib/email/compose';
import { triageInbox, applyTriageLabels, type TriageItem, type TriagePriority } from '../../lib/email/triage';

interface ListMessage { id: string; from: string; subject: string; snippet: string }
interface ThreadMessage { id?: string; threadId?: string; from?: string; to?: string; subject?: string; date?: string; body?: string }
interface GmailLabel { id: string; name: string; type?: string }

const QUICK_FILTERS: Array<{ id: string; label: string; query: string }> = [
  { id: 'inbox', label: 'Beérkező', query: 'in:inbox' },
  { id: 'unread', label: 'Olvasatlan', query: 'is:unread' },
  { id: 'starred', label: 'Csillagozott', query: 'is:starred' },
  { id: 'sent', label: 'Elküldött', query: 'in:sent' },
];

const PRIORITY_COLOR: Record<TriagePriority, string> = {
  high: 'var(--danger)',
  medium: 'var(--warning)',
  low: 'var(--text-hint)',
};

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim() || from;
}

export function EmailPage({ userId, projectId }: { userId: string; projectId?: string | null }) {
  const ctx = useMemo(() => ({ userId, workspaceId: projectId ?? undefined }), [userId, projectId]);
  const registry = useMemo(() => createConnectionRegistry(userId, projectId ?? undefined), [userId, projectId]);

  const [connected, setConnected] = useState(() => providerRuntimeState('google-workspace', ctx) === 'connected');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [query, setQuery] = useState('in:inbox');
  const [activeFilter, setActiveFilter] = useState('inbox');
  const [activeLabel, setActiveLabel] = useState('');
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [messages, setMessages] = useState<ListMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState('');
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const [replyBody, setReplyBody] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyNote, setReplyNote] = useState('');

  const [compose, setCompose] = useState<EmailDraft | null>(null);

  const [triaging, setTriaging] = useState(false);
  const [triageItems, setTriageItems] = useState<TriageItem[]>([]);
  const [triageNote, setTriageNote] = useState('');

  const triageById = useMemo(() => new Map(triageItems.map((t) => [t.id, t])), [triageItems]);

  // ── data loaders ─────────────────────────────────────────────────────────────
  async function runSearch(q: string) {
    if (!connected) return;
    setLoading(true);
    setError('');
    try {
      const res = await registry.call('google-workspace', 'google.gmail.search', { query: q, max_results: 30 });
      if (!res.success) { setError(res.error || res.output || 'A keresés nem sikerült.'); setMessages([]); return; }
      const list = (res.details as { messages?: ListMessage[] } | undefined)?.messages ?? [];
      setMessages(list);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function loadLabels() {
    if (!connected) return;
    const res = await registry.call('google-workspace', 'google.gmail.list_labels', {});
    if (res.success) {
      const all = (res.details as { labels?: GmailLabel[] } | undefined)?.labels ?? [];
      // User labels only: prefer the API's `type`, fall back to skipping all-caps
      // system ids (INBOX, SENT, CATEGORY_PERSONAL, …).
      setLabels(all.filter((l) => l.id && (l.type ? l.type === 'user' : !/^[A-Z_]+$/.test(l.id))));
    }
  }

  async function openThread(messageId: string) {
    setSelectedId(messageId);
    setThread([]);
    setReplyBody('');
    setReplyNote('');
    setThreadLoading(true);
    try {
      const res = await registry.call('google-workspace', 'google.gmail.read_thread', { messageId });
      if (res.success) {
        setThread((res.details as { messages?: ThreadMessage[] } | undefined)?.messages ?? []);
      } else {
        setReplyNote(res.error || res.output || 'A szál betöltése nem sikerült.');
      }
    } catch (e) {
      setReplyNote(String((e as Error)?.message ?? e));
    } finally {
      setThreadLoading(false);
    }
  }

  useEffect(() => {
    if (connected) { void runSearch(query); void loadLabels(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── actions ──────────────────────────────────────────────────────────────────
  function pickFilter(f: { id: string; query: string }) {
    setActiveFilter(f.id);
    setActiveLabel('');
    setQuery(f.query);
    void runSearch(f.query);
  }

  function pickLabel(l: GmailLabel) {
    setActiveFilter('');
    setActiveLabel(l.id);
    const q = `label:${/\s/.test(l.name) ? `"${l.name}"` : l.name}`;
    setQuery(q);
    void runSearch(q);
  }

  async function handleConnect() {
    if (connecting) return;
    setConnecting(true);
    setConnectError('');
    try {
      await beginOAuthConnect('google-workspace', { userId });
      setConnected(true);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setConnectError(
        msg.includes('oauth_loopback_unavailable') ? 'A csatlakozás a Larund asztali appot igényli.'
        : msg.includes('oauth_cancelled') ? 'A bejelentkezés megszakadt vagy lejárt.'
        : msg.includes('developer_setup_missing') ? 'A Google OAuth alkalmazás nincs beállítva (hiányzó Client ID).'
        : `A csatlakozás nem sikerült: ${msg}`,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !replyBody.trim() || replyBusy) return;
    setReplyBusy(true);
    setReplyNote('');
    try {
      const draftRes = await registry.call('google-workspace', 'google.gmail.create_reply_draft', {
        messageId: selectedId, body: replyBody,
      });
      if (!draftRes.success) { setReplyNote(draftRes.error || draftRes.output || 'A válasz piszkozat nem jött létre.'); return; }
      const draftId = String((draftRes.details as { draftId?: string } | undefined)?.draftId ?? '');
      const sendRes = await registry.call('google-workspace', 'google.gmail.send', draftId ? { draftId } : {});
      setReplyNote(sendRes.success ? '✓ Válasz elküldve.' : (sendRes.error || sendRes.output || 'A küldés nem sikerült.'));
      if (sendRes.success) setReplyBody('');
    } catch (e) {
      setReplyNote(String((e as Error)?.message ?? e));
    } finally {
      setReplyBusy(false);
    }
  }

  async function archive(messageId: string) {
    const res = await registry.call('google-workspace', 'google.gmail.modify_labels', {
      messageIds: [messageId], removeLabelIds: ['INBOX'],
    });
    if (res.success) {
      setMessages((cur) => cur.filter((m) => m.id !== messageId));
      if (selectedId === messageId) { setSelectedId(''); setThread([]); }
    } else {
      setReplyNote(res.error || res.output || 'Az archiválás nem sikerült.');
    }
  }

  function startCompose() {
    setCompose({
      id: newEmailDraftId(), to: '', subject: '', body: '',
      status: 'local_draft', gmailConnected: connected, updatedAt: new Date().toISOString(),
    });
  }

  async function runTriage() {
    if (triaging) return;
    setTriaging(true);
    setTriageNote('');
    try {
      const res = await triageInbox(userId, { projectId: projectId ?? undefined, query: 'in:inbox', maxResults: 20 });
      setTriageItems(res.items);
      if (res.error) setTriageNote(res.error);
      else setTriageNote(`${res.items.length} levél elemezve. Nézd át, majd alkalmazd a javasolt címkéket.`);
    } catch (e) {
      setTriageNote(String((e as Error)?.message ?? e));
    } finally {
      setTriaging(false);
    }
  }

  async function applyLabels() {
    if (!triageItems.length) return;
    setTriaging(true);
    try {
      const res = await applyTriageLabels(userId, triageItems.map((t) => ({ id: t.id, suggestedLabel: t.suggestedLabel })), { projectId: projectId ?? undefined });
      setTriageNote(`${res.applied} levél címkézve.${res.errors.length ? ' Hibák: ' + res.errors.join('; ') : ''}`);
      await loadLabels();
    } catch (e) {
      setTriageNote(String((e as Error)?.message ?? e));
    } finally {
      setTriaging(false);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <PageFrame>
        <PageHeader title="Email" subtitle="Kösd be a Gmail-fiókodat a levelek kereséséhez, olvasásához és küldéséhez." />
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            A Gmail még nincs csatlakoztatva ehhez a fiókhoz. Egy kattintással bejelentkezel a böngészőben, és visszatérsz ide — utána az összes leveled itt kereshető és kezelhető.
          </div>
          <button style={btn} disabled={connecting} onClick={handleConnect}>
            <Icon name="mail" size={14} stroke={1.8} /> {connecting ? 'Csatlakozás…' : 'Gmail csatlakoztatása'}
          </button>
          {connectError && <div style={{ marginTop: 10, color: 'var(--danger)', fontSize: 12.5 }}>{connectError}</div>}
        </div>
      </PageFrame>
    );
  }

  if (compose) {
    return (
      <PageFrame>
        <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={() => setCompose(null)}>
          <Icon name="arrowLeft" size={13} stroke={1.8} /> Vissza a postafiókhoz
        </button>
        <EmailComposerCard draft={compose} userId={userId} onChange={setCompose} />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <PageHeader
        title="Email"
        subtitle="A bekötött Google-fiók levelezése — keresés, rendezés, válasz, küldés."
        actions={
          <>
            <button style={ghostBtn} onClick={runTriage} disabled={triaging}>
              <Icon name="sparkle" size={13} stroke={1.7} /> {triaging ? 'Elemzés…' : 'AI rendezés'}
            </button>
            <button style={btn} onClick={startCompose}>
              <Icon name="plus" size={13} stroke={2} /> Új email
            </button>
          </>
        }
      />

      {/* search + quick filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-hint)' }}>
            <Icon name="search" size={14} stroke={1.7} />
          </span>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setActiveFilter(''); setActiveLabel(''); void runSearch(query); } }}
            placeholder="Gmail keresés (pl. from:ügyfél is:unread)…"
            style={{ ...input, paddingLeft: 32 }}
          />
        </div>
        <button style={ghostBtn} onClick={() => runSearch(query)} disabled={loading}>
          <Icon name="refresh" size={13} stroke={1.7} /> {loading ? 'Keresés…' : 'Frissítés'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {QUICK_FILTERS.map((f) => (
          <button key={f.id} onClick={() => pickFilter(f)}
            style={{ ...ghostBtn, ...(activeFilter === f.id ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>
            {f.label}
          </button>
        ))}
        {labels.slice(0, 8).map((l) => (
          <button key={l.id} onClick={() => pickLabel(l)}
            style={{ ...ghostBtn, ...(activeLabel === l.id ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>
            🏷 {l.name}
          </button>
        ))}
      </div>

      {/* AI triage panel */}
      {(triageItems.length > 0 || triageNote) && (
        <div style={{ ...card, borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: triageItems.length ? 10 : 0 }}>
            <Icon name="sparkle" size={14} stroke={1.7} style={{ color: 'var(--accent)' }} />
            <strong style={{ fontSize: 13 }}>AI rendezés</strong>
            <div style={{ flex: 1 }} />
            {triageItems.length > 0 && (
              <button style={btn} onClick={applyLabels} disabled={triaging}>Javasolt címkék alkalmazása</button>
            )}
          </div>
          {triageNote && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: triageItems.length ? 10 : 0 }}>{triageNote}</div>}
          {triageItems.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: PRIORITY_COLOR[t.priority], flex: 'none', alignSelf: 'center' }} />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
              <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>🏷 {t.suggestedLabel}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ ...card, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 12.5 }}>{error}</div>}

      {/* two-pane: list + thread */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedId ? 'minmax(260px, 360px) 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {messages.length === 0 && !loading && <Empty text="Nincs találat ehhez a kereséshez." icon="mail" />}
          {messages.map((m) => {
            const tri = triageById.get(m.id);
            const active = m.id === selectedId;
            return (
              <button key={m.id} onClick={() => openThread(m.id)} style={{
                display: 'block', width: '100%', textAlign: 'left', background: active ? 'var(--bg)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {tri && <span style={{ width: 6, height: 6, borderRadius: 999, background: PRIORITY_COLOR[tri.priority], flex: 'none' }} />}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {senderName(m.from)}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject || '(tárgy nélkül)'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tri?.summary || m.snippet}
                </div>
              </button>
            );
          })}
        </div>

        {selectedId && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {thread[0]?.subject || 'Szál'}
              </strong>
              <button style={ghostBtn} onClick={() => archive(selectedId)}>Archiválás</button>
              <button style={ghostBtn} onClick={() => { setSelectedId(''); setThread([]); }}>
                <Icon name="x" size={13} stroke={1.8} />
              </button>
            </div>

            {threadLoading && <div style={{ fontSize: 12, color: 'var(--text-hint)', padding: 8 }}>Betöltés…</div>}
            <div style={{ display: 'grid', gap: 10, maxHeight: 420, overflow: 'auto' }}>
              {thread.map((msg, i) => (
                <div key={msg.id ?? i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--bg)' }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--text-hint)', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{senderName(msg.from ?? '')}</span>
                    <div style={{ flex: 1 }} />
                    <span>{msg.date}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.body}</div>
                </div>
              ))}
            </div>

            {/* reply */}
            <div style={{ marginTop: 12 }}>
              <textarea
                value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Válasz írása… (Markdown támogatott)"
                style={{ ...input, minHeight: 90, resize: 'vertical', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <button style={btn} onClick={sendReply} disabled={replyBusy || !replyBody.trim()}>
                  <Icon name="send" size={13} stroke={1.7} /> {replyBusy ? 'Küldés…' : 'Válasz küldése'}
                </button>
                {replyNote && <span style={{ fontSize: 12, color: replyNote.startsWith('✓') ? 'var(--success)' : 'var(--text-muted)' }}>{replyNote}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
