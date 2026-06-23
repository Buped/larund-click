import React, { useState } from 'react';
import { createConnectionRegistry } from '../lib/connections/registry';
import { Icon } from './icons';
import type { SearchCitation } from '../lib/search-citations';

// ─── Inline parser ─────────────────────────────────────────────────────────────
// Handles: **bold**, __bold__, *italic*, _italic_, `code`, [link](url)
// Unmatched * or _ are stripped.

function parseInline(text: string, citations: SearchCitation[] = []): React.ReactNode[] {
  const PAT = /\*\*(.+?)\*\*|__(.+?)__|[*_]([^*_\n]+?)[*_]|`([^`\n]+?)`|\[([^\]]+)\]\(([^)\n]+)\)|\[\^(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let last = 0, ki = 0;
  let m: RegExpExecArray | null;

  while ((m = PAT.exec(text)) !== null) {
    if (m.index > last) {
      const seg = text.slice(last, m.index).replace(/[*_]+/g, '');
      if (seg) parts.push(seg);
    }

    if (m[1] !== undefined) {
      parts.push(<strong key={'b' + ki++} style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      parts.push(<strong key={'b' + ki++} style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      parts.push(<em key={'i' + ki++} style={{ fontStyle: 'italic', opacity: 0.88 }}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      parts.push(
        <code key={'c' + ki++} style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.875em',
          background: 'var(--accent-soft)', color: 'var(--accent)',
          padding: '2px 6px', borderRadius: 4,
        }}>
          {m[4]}
        </code>,
      );
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const url = m[6];
      parts.push(
        <a
          key={'l' + ki++}
          href={url}
          onClick={(e) => { e.preventDefault(); window.open(url, '_blank'); }}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(74,158,255,0.35)',
            textUnderlineOffset: '3px',
            cursor: 'pointer',
          }}
        >
          {m[5]}
        </a>,
      );
    } else if (m[7] !== undefined) {
      const n = Number(m[7]);
      const citation = citations.find((c) => c.sequence_number === n);
      parts.push(
        <button
          key={'cite' + ki++}
          type="button"
          className="citation-marker"
          title={citation ? `${citation.title}\n${citation.url}` : `Source ${n}`}
          onClick={() => citation?.url && window.open(citation.url, '_blank')}
        >
          {n}
        </button>,
      );
    }
    last = PAT.lastIndex;
  }

  if (last < text.length) {
    const seg = text.slice(last).replace(/[*_]+/g, '');
    if (seg) parts.push(seg);
  }

  return parts;
}

// ─── Block components ──────────────────────────────────────────────────────────

function RMHeading({ level, text, citations }: { level: number; text: string; citations?: SearchCitation[] }) {
  const sizes   = [18, 15.5, 14, 13.5];
  const weights = [700,   650, 600,  600];
  const margins = [  6,     3,   2,    0];
  return (
    <div style={{
      fontSize:     sizes[level - 1]   ?? 13.5,
      fontWeight:   weights[level - 1] ?? 600,
      color:        'var(--text-primary)',
      lineHeight:   1.3,
      marginBottom: margins[level - 1] ?? 0,
    }}>
      {parseInline(text, citations)}
    </div>
  );
}

function RMParagraph({ text, citations }: { text: string; citations?: SearchCitation[] }) {
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: 'inherit', lineHeight: 1.75 }}>
      {text.split('\n').map((line, i, arr) => (
        <React.Fragment key={i}>
          {parseInline(line, citations)}
          {i < arr.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
  );
}

// Bullet item: supports nesting via leading spaces
type BulletItem = { text: string; depth: number; children: BulletItem[] };

function buildBulletTree(items: string[]): BulletItem[] {
  const root: BulletItem[] = [];
  const stack: { depth: number; list: BulletItem[] }[] = [{ depth: -1, list: root }];

  for (const raw of items) {
    const indent = raw.match(/^(\s*)/)?.[1].length ?? 0;
    const depth = Math.floor(indent / 2);
    const text = raw.replace(/^\s*[-*•]\s/, '');
    const item: BulletItem = { text, depth, children: [] };

    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    stack[stack.length - 1].list.push(item);
    stack.push({ depth, list: item.children });
  }

  return root;
}

function RenderBulletItem({ item, citations }: { item: BulletItem; citations?: SearchCitation[] }) {
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent)', flex: 'none', fontSize: 6, lineHeight: 1, marginTop: 7 }}>●</span>
        <span style={{ fontSize: 13.5, color: 'inherit', lineHeight: 1.7 }}>
          {parseInline(item.text, citations)}
        </span>
      </div>
      {item.children.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {item.children.map((child, i) => <RenderBulletItem key={i} item={child} citations={citations} />)}
        </ul>
      )}
    </li>
  );
}

function RMBulletList({ items, citations }: { items: string[]; citations?: SearchCitation[] }) {
  const tree = buildBulletTree(items);
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tree.map((item, i) => <RenderBulletItem key={i} item={item} citations={citations} />)}
    </ul>
  );
}

function RMNumberedList({ items, citations }: { items: string[]; citations?: SearchCitation[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => {
        const raw = item.replace(/^\d+\.\s/, '');
        return (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{
              width: 20, height: 20, borderRadius: 5, flex: 'none', marginTop: 2,
              background: 'rgba(74,158,255,0.13)', color: 'var(--accent)',
              display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
            }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 13.5, color: 'inherit', lineHeight: 1.7 }}>
              {parseInline(raw, citations)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Code block with Copy button ──────────────────────────────────────────────
function RMCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {
        const el = document.createElement('textarea');
        el.value = code;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || 'code'}</span>
        <button className={`code-copy-btn${copied ? ' code-copy-btn--done' : ''}`} onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-block-pre">{code}</pre>
    </div>
  );
}

function RMBlockquote({ text, citations }: { text: string; citations?: SearchCitation[] }) {
  return (
    <div style={{
      padding: '10px 15px',
      borderLeft: '2.5px solid var(--accent)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(74,158,255,0.06)',
    }}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'inherit', lineHeight: 1.7, fontStyle: 'italic', opacity: 0.9 }}>
        {text.split('\n').map((line, i, arr) => (
          <React.Fragment key={i}>
            {parseInline(line, citations)}
            {i < arr.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}

function RMDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />;
}

function SourcesList({ citations }: { citations: SearchCitation[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (citations.length === 0) return null;
  const q = query.trim().toLowerCase();
  const visible = q
    ? citations.filter((c) => `${c.title} ${c.domain} ${c.snippet ?? ''}`.toLowerCase().includes(q))
    : citations;
  return (
    <div className="sources-list">
      <button type="button" className="sources-list__trigger" onClick={() => setOpen((v) => !v)}>
        <Icon name="chevronDown" size={13} stroke={1.8} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .16s' }} />
        <span>Sources ({citations.length})</span>
      </button>
      {open && (
        <div className="sources-list__body">
          {citations.length > 10 && (
            <input
              className="sources-list__filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter sources"
            />
          )}
          <div className="sources-list__items">
            {visible.map((citation) => (
              <a
                key={citation.citation_id}
                className="sources-list__item"
                href={citation.url}
                onClick={(event) => { event.preventDefault(); window.open(citation.url, '_blank'); }}
              >
                <span className="sources-list__number">{citation.sequence_number}</span>
                <span className="sources-list__main">
                  <span className="sources-list__title">{citation.title}</span>
                  <span className="sources-list__domain">{citation.domain}</span>
                  {citation.snippet && <span className="sources-list__snippet">{citation.snippet}</span>}
                </span>
                <Icon name="externalLink" size={13} stroke={1.6} style={{ color: 'var(--text-hint)' }} />
              </a>
            ))}
            {visible.length === 0 && <div className="sources-list__empty">No matching sources.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function RMTable({ headers, rows, citations }: { headers: string[]; rows: string[][]; citations?: SearchCitation[] }) {
  return (
    <div className="rm-table-wrap">
      <table className="rm-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="rm-th">{parseInline(h.trim(), citations)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 !== 0 ? 'rm-tr-alt' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="rm-td">{parseInline(cell.trim(), citations)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Block parser ──────────────────────────────────────────────────────────────

function parseJsonPayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function cardInputStyle(multiline = false): React.CSSProperties {
  return {
    width: '100%',
    minHeight: multiline ? 150 : 32,
    resize: multiline ? 'vertical' : 'none',
    border: '1px solid var(--border-md)',
    borderRadius: 7,
    background: 'var(--bg-field)',
    color: 'var(--text-primary)',
    padding: multiline ? '9px 10px' : '0 10px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    lineHeight: multiline ? 1.55 : undefined,
    outline: 'none',
  };
}

function CardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-hint)', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      {children}
    </label>
  );
}

function EmailCard({ raw, userId }: { raw: string; userId?: string }) {
  const payload = parseJsonPayload<EmailCardPayload>(raw) ?? {};
  const [to, setTo] = useState(payload.to ?? '');
  const [cc, setCc] = useState(payload.cc ?? '');
  const [bcc, setBcc] = useState(payload.bcc ?? '');
  const [subject, setSubject] = useState(payload.subject ?? '');
  const [body, setBody] = useState(payload.body ?? '');
  const [expanded, setExpanded] = useState(Boolean(payload.cc || payload.bcc));
  const [status, setStatus] = useState<'draft' | 'saving' | 'sending' | 'sent' | 'failed'>('draft');
  const [message, setMessage] = useState('');

  async function call(tool: string, args: Record<string, unknown>) {
    if (!userId) throw new Error('Google operation needs a signed-in user.');
    const result = await createConnectionRegistry(userId).call('google-workspace', tool, args);
    if (!result.success) throw new Error(result.error || result.output || 'Google operation failed.');
    return result;
  }

  async function saveDraft() {
    setStatus('saving');
    setMessage('');
    try {
      const result = await call('google.gmail.create_draft', { to, cc, bcc, subject, body, threadId: payload.threadId });
      setStatus('draft');
      setMessage(result.output || 'Draft saved.');
    } catch (error) {
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function send() {
    setStatus('sending');
    setMessage('');
    try {
      const result = await call('google.gmail.send', { to, cc, bcc, subject, body, threadId: payload.threadId });
      setStatus('sent');
      setMessage(result.output || `Sent at ${new Date().toLocaleString()}.`);
    } catch (error) {
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const readOnly = status === 'sent' || status === 'sending' || status === 'saving';
  const recipientDomain = to.split('@')[1]?.split(/[>,\s;]/)[0];

  return (
    <div style={{ border: '1px solid var(--border-md)', borderRadius: 10, background: 'rgba(var(--ov-color),0.025)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="mail" size={15} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Email</strong>
        {recipientDomain && <span className="pill pill-amber" style={{ marginLeft: 4, height: 21 }}>New recipient</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: status === 'sent' ? 'var(--success)' : status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>{status}</span>
      </div>
      <div style={{ display: 'grid', gap: 10, padding: 12 }}>
        <CardField label="To"><input value={to} onChange={(event) => setTo(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        {expanded && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <CardField label="CC"><input value={cc} onChange={(event) => setCc(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
            <CardField label="BCC"><input value={bcc} onChange={(event) => setBcc(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
          </div>
        )}
        {!expanded && <button className="btn btn-ghost" onClick={() => setExpanded(true)} style={{ justifySelf: 'start', height: 28, fontSize: 11.5 }}>CC/BCC</button>}
        <CardField label="Subject"><input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        <CardField label="Body"><textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={readOnly} style={cardInputStyle(true)} /></CardField>
        {payload.attachments?.length ? (
          <div style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-hint)', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '.06em' }}>Attached items</span>
            {payload.attachments.map((att, index) => (
              <a key={index} href={att.url} onClick={(event) => { event.preventDefault(); if (att.url) window.open(att.url, '_blank'); }} style={{ color: 'var(--accent)', fontSize: 12.5 }}>
                {att.label ?? att.url ?? 'Drive item'} ({att.mode ?? 'link'})
              </a>
            ))}
          </div>
        ) : null}
        {message && <div style={{ color: status === 'failed' ? 'var(--danger)' : 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.45 }}>{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {status === 'failed' && <button className="btn btn-ghost" onClick={() => setStatus('draft')}>Edit</button>}
          <button className="btn btn-ghost" onClick={() => void saveDraft()} disabled={readOnly || !to}>Save draft</button>
          <button className="btn btn-primary" onClick={() => void send()} disabled={readOnly || !to}>{status === 'sending' ? 'Sending...' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

function CalendarEventCard({ raw, userId }: { raw: string; userId?: string }) {
  const payload = parseJsonPayload<CalendarEventCardPayload>(raw) ?? {};
  const [summary, setSummary] = useState(payload.summary ?? '');
  const [start, setStart] = useState(payload.start ?? '');
  const [end, setEnd] = useState(payload.end ?? '');
  const [location, setLocation] = useState(payload.location ?? '');
  const [attendees, setAttendees] = useState(Array.isArray(payload.attendees) ? payload.attendees.join(', ') : payload.attendees ?? '');
  const [description, setDescription] = useState(payload.description ?? '');
  const [status, setStatus] = useState<'draft' | 'creating' | 'created' | 'failed'>('draft');
  const [message, setMessage] = useState('');

  async function createEvent() {
    setStatus('creating');
    setMessage('');
    try {
      if (!userId) throw new Error('Google Calendar operation needs a signed-in user.');
      const result = await createConnectionRegistry(userId).call('google-workspace', 'google.calendar.create_event', {
        calendarId: payload.calendarId ?? 'primary',
        summary,
        start,
        end,
        location,
        description,
        attendees,
      });
      if (!result.success) throw new Error(result.error || result.output || 'Calendar operation failed.');
      setStatus('created');
      setMessage(result.output || 'Event created and verified.');
    } catch (error) {
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const readOnly = status === 'created' || status === 'creating';
  return (
    <div style={{ border: '1px solid var(--border-md)', borderRadius: 10, background: 'rgba(var(--ov-color),0.025)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="calendar" size={15} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Calendar event</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: status === 'created' ? 'var(--success)' : status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>{status}</span>
      </div>
      <div style={{ display: 'grid', gap: 10, padding: 12 }}>
        <CardField label="Title"><input value={summary} onChange={(event) => setSummary(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <CardField label="Start"><input value={start} onChange={(event) => setStart(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
          <CardField label="End"><input value={end} onChange={(event) => setEnd(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        </div>
        <CardField label="Location"><input value={location} onChange={(event) => setLocation(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        <CardField label="Guests"><input value={attendees} onChange={(event) => setAttendees(event.target.value)} disabled={readOnly} style={cardInputStyle()} /></CardField>
        <CardField label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={readOnly} style={cardInputStyle(true)} /></CardField>
        {message && <div style={{ color: status === 'failed' ? 'var(--danger)' : 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.45 }}>{message}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {status === 'failed' && <button className="btn btn-ghost" onClick={() => setStatus('draft')}>Edit</button>}
          <button className="btn btn-primary" onClick={() => void createEvent()} disabled={readOnly || !summary || !start || !end}>{status === 'creating' ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

function metric(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function XPostCard({ raw }: { raw: string }) {
  const payload = parseJsonPayload<XPostCardPayload>(raw) ?? {};
  const handle = payload.author?.username ? `@${payload.author.username}` : payload.author?.name ?? 'X post';
  const url = payload.url ?? (payload.id ? `https://x.com/i/web/status/${payload.id}` : undefined);
  const m = payload.metrics ?? {};
  return (
    <div style={{ border: '1px solid var(--border-md)', borderRadius: 8, background: 'rgba(var(--ov-color),0.025)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        {payload.author?.profileImageUrl ? <img src={payload.author.profileImageUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} /> : <Icon name="message" size={15} style={{ color: 'var(--text-muted)' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{payload.author?.name ?? handle}</strong>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{handle}{payload.createdAt ? ` · ${new Date(payload.createdAt).toLocaleString()}` : ''}</div>
        </div>
        {url && <button className="btn btn-ghost" onClick={() => window.open(url, '_blank')} style={{ height: 28, fontSize: 11.5 }}>Open on X</button>}
      </div>
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{payload.text}</div>
        {payload.mediaPreviewUrl && <img src={payload.mediaPreviewUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--border)' }} />}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-hint)' }}>
          <span>{metric(m.reply_count)} replies</span>
          <span>{metric(m.retweet_count)} reposts</span>
          <span>{metric(m.like_count)} likes</span>
          <span>{metric(m.impression_count)} views</span>
        </div>
      </div>
    </div>
  );
}

function XUserCard({ raw }: { raw: string }) {
  const payload = parseJsonPayload<XUserCardPayload>(raw) ?? {};
  const handle = payload.username ? `@${payload.username}` : payload.id ?? 'X user';
  const url = payload.url ?? (payload.username ? `https://x.com/${payload.username}` : payload.id ? `https://x.com/i/user/${payload.id}` : undefined);
  const m = payload.metrics ?? {};
  return (
    <div style={{ border: '1px solid var(--border-md)', borderRadius: 8, background: 'rgba(var(--ov-color),0.025)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
        {payload.profileImageUrl ? <img src={payload.profileImageUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} /> : <Icon name="user" size={18} style={{ color: 'var(--text-muted)' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{payload.name ?? handle}{payload.verified ? ' ✓' : ''}</strong>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{handle}</div>
        </div>
        {url && <button className="btn btn-ghost" onClick={() => window.open(url, '_blank')} style={{ height: 28, fontSize: 11.5 }}>Open on X</button>}
      </div>
      <div style={{ padding: '0 12px 12px', display: 'grid', gap: 9 }}>
        {payload.description && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{payload.description}</div>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-hint)' }}>
          <span>{metric(m.followers_count)} followers</span>
          <span>{metric(m.following_count)} following</span>
          <span>{metric(m.tweet_count)} posts</span>
        </div>
      </div>
    </div>
  );
}

function XScheduledPostCard({ raw }: { raw: string }) {
  const payload = parseJsonPayload<XScheduledPostCardPayload>(raw) ?? {};
  const status = payload.status ?? 'pending';
  const color = status === 'sent' ? 'var(--success)' : status === 'failed' ? 'var(--danger)' : status === 'cancelled' ? 'var(--text-hint)' : 'var(--warning)';
  return (
    <div style={{ border: '1px solid var(--border-md)', borderRadius: 8, background: 'rgba(var(--ov-color),0.025)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="calendar" size={15} style={{ color }} />
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Scheduled X post</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color }}>{status}</span>
      </div>
      <div style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>Scheduled for {payload.scheduledFor ? new Date(payload.scheduledFor).toLocaleString() : 'unknown time'}</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{payload.content}</div>
        {payload.xPostId && <button className="btn btn-ghost" onClick={() => window.open(`https://x.com/i/web/status/${payload.xPostId}`, '_blank')} style={{ justifySelf: 'start', height: 28, fontSize: 11.5 }}>Open on X</button>}
        {payload.error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{payload.error}</div>}
      </div>
    </div>
  );
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'blockquote'; text: string }
  | { type: 'divider' }
  | { type: 'table'; headers: string[]; rows: string[][] };

interface EmailCardPayload {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  threadId?: string;
  attachments?: Array<{ label?: string; url?: string; mode?: 'link' | 'attachment' }>;
  autoSend?: boolean;
}

interface CalendarEventCardPayload {
  summary?: string;
  start?: string;
  end?: string;
  location?: string;
  attendees?: string[] | string;
  description?: string;
  calendarId?: string;
}

interface XPostCardPayload {
  id?: string;
  text?: string;
  url?: string;
  createdAt?: string;
  mediaPreviewUrl?: string;
  author?: { name?: string; username?: string; profileImageUrl?: string };
  metrics?: Record<string, unknown>;
}

interface XUserCardPayload {
  id?: string;
  username?: string;
  name?: string;
  description?: string;
  profileImageUrl?: string;
  verified?: boolean;
  url?: string;
  metrics?: Record<string, unknown>;
}

interface XScheduledPostCardPayload {
  id?: string;
  content?: string;
  scheduledFor?: string;
  status?: 'pending' | 'sent' | 'failed' | 'cancelled';
  xPostId?: string;
  error?: string;
}

function parseRow(line: string): string[] {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      i++;
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────────
    if (line.startsWith('>')) {
      const qlines = [line.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].startsWith('>')) {
        i++;
        qlines.push(lines[i].replace(/^>\s?/, ''));
      }
      blocks.push({ type: 'blockquote', text: qlines.join('\n') });
      i++;
      continue;
    }

    // ── Headings (longest prefix first to avoid partial matches) ──────────────
    if (line.startsWith('#### ')) { blocks.push({ type: 'heading', level: 4, text: line.slice(5) }); i++; continue; }
    if (line.startsWith('### '))  { blocks.push({ type: 'heading', level: 3, text: line.slice(4) }); i++; continue; }
    if (line.startsWith('## '))   { blocks.push({ type: 'heading', level: 2, text: line.slice(3) }); i++; continue; }
    if (line.startsWith('# '))    { blocks.push({ type: 'heading', level: 1, text: line.slice(2) }); i++; continue; }

    // ── Horizontal rule ────────────────────────────────────────────────────────
    if (/^---+$/.test(line.trim())) { blocks.push({ type: 'divider' }); i++; continue; }

    // ── Blank line ─────────────────────────────────────────────────────────────
    if (line.trim() === '') { i++; continue; }

    // ── Table: lines starting with | ──────────────────────────────────────────
    if (line.trim().startsWith('|')) {
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i++;
        tableLines.push(lines[i]);
      }
      if (tableLines.length >= 3 && /^\|[\s\-:|]+\|$/.test(tableLines[1].trim())) {
        blocks.push({
          type: 'table',
          headers: parseRow(tableLines[0]),
          rows: tableLines.slice(2).map(parseRow),
        });
      } else {
        blocks.push({ type: 'paragraph', text: tableLines.join('\n') });
      }
      i++;
      continue;
    }

    // ── Bullet list ────────────────────────────────────────────────────────────
    if (/^\s*[-*•]\s/.test(line)) {
      const items = [line];
      while (i + 1 < lines.length && /^\s*[-*•]\s/.test(lines[i + 1])) {
        i++;
        items.push(lines[i]);
      }
      blocks.push({ type: 'bullets', items });
      i++;
      continue;
    }

    // ── Numbered list ──────────────────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const items = [line];
      while (i + 1 < lines.length && /^\d+\.\s/.test(lines[i + 1])) {
        i++;
        items.push(lines[i]);
      }
      blocks.push({ type: 'numbered', items });
      i++;
      continue;
    }

    // ── Paragraph ──────────────────────────────────────────────────────────────
    const paraLines = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() !== '' &&
      !lines[i + 1].startsWith('```') &&
      !lines[i + 1].startsWith('>') &&
      !lines[i + 1].startsWith('# ') &&
      !lines[i + 1].startsWith('## ') &&
      !lines[i + 1].startsWith('### ') &&
      !lines[i + 1].trim().startsWith('|') &&
      !/^\s*[-*•]\s/.test(lines[i + 1]) &&
      !/^\d+\.\s/.test(lines[i + 1]) &&
      !/^---+$/.test(lines[i + 1].trim())
    ) {
      i++;
      paraLines.push(lines[i]);
    }
    blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    i++;
  }

  return blocks;
}

// ─── Export ────────────────────────────────────────────────────────────────────

export function RichMessage({ content, userId, citations = [] }: { content: string; userId?: string; citations?: SearchCitation[] }) {
  const blocks = parseBlocks(content);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':    return <RMHeading      key={i} level={block.level} text={block.text} citations={citations} />;
          case 'paragraph':  return <RMParagraph    key={i} text={block.text} citations={citations} />;
          case 'bullets':    return <RMBulletList   key={i} items={block.items} citations={citations} />;
          case 'numbered':   return <RMNumberedList key={i} items={block.items} citations={citations} />;
          case 'code':
            if (block.lang === 'email_card') return <EmailCard key={i} raw={block.code} userId={userId} />;
            if (block.lang === 'calendar_event_card') return <CalendarEventCard key={i} raw={block.code} userId={userId} />;
            if (block.lang === 'x_post_card') return <XPostCard key={i} raw={block.code} />;
            if (block.lang === 'x_user_card') return <XUserCard key={i} raw={block.code} />;
            if (block.lang === 'x_scheduled_post_card') return <XScheduledPostCard key={i} raw={block.code} />;
            return <RMCodeBlock key={i} lang={block.lang} code={block.code} />;
          case 'blockquote': return <RMBlockquote   key={i} text={block.text} citations={citations} />;
          case 'divider':    return <RMDivider      key={i} />;
          case 'table':      return <RMTable        key={i} headers={block.headers} rows={block.rows} citations={citations} />;
          default:           return null;
        }
      })}
      <SourcesList citations={citations} />
    </div>
  );
}
