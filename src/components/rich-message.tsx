import React, { useState } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { createConnectionRegistry } from '../lib/connections/registry';
import { Icon } from './icons';
import type { SearchCitation } from '../lib/search-citations';
import { sanitizeVisualizationHtml } from '../lib/assistant/rich-format';
import { sourcesFromSearchCitations, type AnswerModelMetadata, type WebSource } from '../lib/web-search/metadata';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('xml', xml);

// ─── Inline parser ─────────────────────────────────────────────────────────────
// Handles: **bold**, __bold__, *italic*, _italic_, `code`, [link](url)
// Unmatched * or _ are stripped.

async function openExternal(url: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function faviconFor(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch {
    return undefined;
  }
}

function sourceForCitation(citation: SearchCitation | undefined, sources: WebSource[]): WebSource | undefined {
  if (!citation) return undefined;
  return sources.find((source) => source.url === citation.url);
}

function parseInline(text: string, citations: SearchCitation[] = [], sources: WebSource[] = []): React.ReactNode[] {
  const PAT = /==(.+?)==|\*\*(.+?)\*\*|__(.+?)__|[*_]([^*_\n]+?)[*_]|`([^`\n]+?)`|\[([^\]]+)\]\(([^)\n]+)\)|\[\^(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let last = 0, ki = 0;
  let m: RegExpExecArray | null;

  while ((m = PAT.exec(text)) !== null) {
    if (m.index > last) {
      const seg = text.slice(last, m.index).replace(/[*_]+/g, '');
      if (seg) parts.push(seg);
    }

    if (m[1] !== undefined) {
      parts.push(<mark key={'h' + ki++} className="rm-inline-highlight">{m[1]}</mark>);
    } else if (m[2] !== undefined) {
      parts.push(<strong key={'b' + ki++} style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      parts.push(<strong key={'b' + ki++} style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      parts.push(<em key={'i' + ki++} style={{ fontStyle: 'italic', opacity: 0.88 }}>{m[4]}</em>);
    } else if (m[5] !== undefined) {
      parts.push(
        <code key={'c' + ki++} style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.875em',
          background: 'var(--accent-soft)', color: 'var(--accent)',
          padding: '2px 6px', borderRadius: 4,
        }}>
          {m[5]}
        </code>,
      );
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const url = m[7];
      parts.push(
        <a
          key={'l' + ki++}
          href={url}
          onClick={(e) => { e.preventDefault(); void openExternal(url); }}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(var(--accent-rgb),0.35)',
            textUnderlineOffset: '3px',
            cursor: 'pointer',
          }}
        >
          {m[6]}
        </a>,
      );
    } else if (m[8] !== undefined) {
      const n = Number(m[8]);
      const citation = citations.find((c) => c.sequence_number === n);
      const source = sourceForCitation(citation, sources);
      const label = source?.domain ?? citation?.domain ?? `Source ${n}`;
      parts.push(
        <button
          key={'cite' + ki++}
          type="button"
          className="citation-marker"
          title={citation ? `${source?.title ?? citation.title}\n${citation.url}` : `Source ${n}`}
          onClick={() => citation?.url && void openExternal(citation.url)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 150,
            height: 20,
            padding: '0 6px',
            verticalAlign: 'baseline',
          }}
        >
          {citation?.url && <img src={faviconFor(citation.url)} alt="" style={{ width: 12, height: 12, borderRadius: 2, flex: 'none' }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
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

function RMHeading({ level, text, citations, sources }: { level: number; text: string; citations?: SearchCitation[]; sources?: WebSource[] }) {
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
      {parseInline(text, citations, sources)}
    </div>
  );
}

function RMParagraph({ text, citations, sources }: { text: string; citations?: SearchCitation[]; sources?: WebSource[] }) {
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: 'inherit', lineHeight: 1.75 }}>
      {text.split('\n').map((line, i, arr) => (
        <React.Fragment key={i}>
          {parseInline(line, citations, sources)}
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

function RenderBulletItem({ item, citations, sources }: { item: BulletItem; citations?: SearchCitation[]; sources?: WebSource[] }) {
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent)', flex: 'none', fontSize: 6, lineHeight: 1, marginTop: 7 }}>●</span>
        <span style={{ fontSize: 13.5, color: 'inherit', lineHeight: 1.7 }}>
          {parseInline(item.text, citations, sources)}
        </span>
      </div>
      {item.children.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {item.children.map((child, i) => <RenderBulletItem key={i} item={child} citations={citations} sources={sources} />)}
        </ul>
      )}
    </li>
  );
}

function RMBulletList({ items, citations, sources }: { items: string[]; citations?: SearchCitation[]; sources?: WebSource[] }) {
  const tree = buildBulletTree(items);
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tree.map((item, i) => <RenderBulletItem key={i} item={item} citations={citations} sources={sources} />)}
    </ul>
  );
}

function RMNumberedList({ items, citations, sources }: { items: string[]; citations?: SearchCitation[]; sources?: WebSource[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => {
        const raw = item.replace(/^\d+\.\s/, '');
        return (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{
              width: 20, height: 20, borderRadius: 5, flex: 'none', marginTop: 2,
              background: 'rgba(var(--accent-rgb),0.13)', color: 'var(--accent)',
              display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
            }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 13.5, color: 'inherit', lineHeight: 1.7 }}>
              {parseInline(raw, citations, sources)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Code block with Copy button ──────────────────────────────────────────────
function copyText(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text)
    .then(onDone)
    .catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      onDone();
    });
}

function highlightedCode(lang: string, code: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

function RMCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const html = highlightedCode(lang, code);

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
      <pre className="code-block-pre"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

function RMCopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <div className="copy-block-header">
        <span className="copy-block-label">Copy</span>
        <button
          className={`code-copy-btn${copied ? ' code-copy-btn--done' : ''}`}
          onClick={() => copyText(text, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="copy-block-pre">{text}</pre>
    </div>
  );
}

export function VisualizationBlock({ html, title = 'Visualization', height }: { html: string; title?: string; height?: number }) {
  const [copied, setCopied] = useState(false);
  const safeHtml = sanitizeVisualizationHtml(html);
  const frameHeight = Number.isFinite(height) ? Math.max(220, Math.min(820, Math.round(height ?? 420))) : undefined;
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#111;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#f4f0ea}
    *{box-sizing:border-box}
    :where(h1,h2,h3,h4,h5,h6,p,span,small,figcaption,li,dt,dd,label,strong,em,b,i,th,td){color:#f4f0ea!important}
    :where(.muted,.subtle,.caption,.note,.axis-label,.tick-label,[data-muted]){color:#a6aeba!important}
    svg{color:#f4f0ea}
    svg :where(text,tspan){fill:#f4f0ea!important;stroke:none!important}
    svg :where(.muted,.subtle,.caption,.note,.axis-label,.tick-label,[data-muted]){fill:#a6aeba!important}
    svg :where(.axis,.domain,.grid,line[stroke="#333"],line[stroke="#444"],path[stroke="#333"],path[stroke="#444"]){stroke:#606977!important}
  </style></head><body>${safeHtml}</body></html>`;

  function handleDownload() {
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'larund-visualization.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="visualization-block">
      <div className="visualization-block-header">
        <span className="visualization-block-title"><span className="dot" /> {title}</span>
        <div className="visualization-block-actions">
          <button
            className={`code-copy-btn${copied ? ' code-copy-btn--done' : ''}`}
            onClick={() => copyText(safeHtml, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
          >
            {copied ? 'Copied' : 'Copy HTML'}
          </button>
          <button className="code-copy-btn" onClick={handleDownload}>Download</button>
        </div>
      </div>
      <iframe title={`Larund visualization - ${title}`} className="visualization-block-frame" sandbox="" srcDoc={srcDoc} style={frameHeight ? { height: frameHeight } : undefined} />
    </div>
  );
}

function RMBlockquote({ text, citations, sources }: { text: string; citations?: SearchCitation[]; sources?: WebSource[] }) {
  return (
    <div style={{
      padding: '10px 15px',
      borderLeft: '2.5px solid var(--accent)',
      borderRadius: '0 8px 8px 0',
      background: 'rgba(var(--accent-rgb),0.06)',
    }}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'inherit', lineHeight: 1.7, fontStyle: 'italic', opacity: 0.9 }}>
        {text.split('\n').map((line, i, arr) => (
          <React.Fragment key={i}>
            {parseInline(line, citations, sources)}
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

function SourcesList({ citations, sources = [] }: { citations: SearchCitation[]; sources?: WebSource[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fallbackSources = citations.length ? sourcesFromSearchCitations(citations) : [];
  const allSources = (sources.length ? sources : fallbackSources)
    .filter((source, index, arr) => arr.findIndex((candidate) => candidate.url === source.url) === index);
  if (allSources.length === 0) return null;
  const q = query.trim().toLowerCase();
  const visible = q
    ? allSources.filter((source) => `${source.title} ${source.domain} ${source.snippet ?? ''}`.toLowerCase().includes(q))
    : allSources;
  const domains = allSources.slice(0, 3).map((source) => source.domain).join(', ');
  return (
    <div className="sources-list">
      <button type="button" className="sources-list__trigger" onClick={() => setOpen((v) => !v)}>
        <Icon name="chevronDown" size={13} stroke={1.8} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .16s' }} />
        <span>Sources: {allSources.length}{domains ? ` · ${domains}${allSources.length > 3 ? ', ...' : ''}` : ''}</span>
      </button>
      {open && (
        <div className="sources-list__body">
          {allSources.length > 8 && (
            <input
              className="sources-list__filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter sources"
            />
          )}
          <div className="sources-list__items">
            {visible.map((source, index) => (
              <div
                key={source.id}
                className="sources-list__item"
                style={{ alignItems: 'flex-start' }}
              >
                <span className="sources-list__number">{source.rank ?? index + 1}</span>
                <span className="sources-list__main">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <img src={faviconFor(source.url)} alt="" style={{ width: 14, height: 14, borderRadius: 3, flex: 'none' }} />
                    <span className="sources-list__title">{source.title}</span>
                  </span>
                  <span className="sources-list__domain">{source.domain} · {source.credibility} · {source.confidence}</span>
                  {source.snippet && <span className="sources-list__snippet">{source.snippet}</span>}
                </span>
                <span style={{ display: 'flex', gap: 5, flex: 'none' }}>
                  <button className="msg-action-btn" type="button" title="Copy link" onClick={() => void navigator.clipboard.writeText(source.url)}>
                    <Icon name="copy" size={12} stroke={1.7} />
                  </button>
                  <button className="msg-action-btn" type="button" title="Open source" onClick={() => void openExternal(source.url)}>
                    <Icon name="externalLink" size={13} stroke={1.6} />
                  </button>
                </span>
              </div>
            ))}
            {visible.length === 0 && <div className="sources-list__empty">No matching sources.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function formatMoney(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `$${value.toFixed(5)}`;
}

function formatLatency(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return undefined;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function ModelMetadataFooter({ metadata }: { metadata?: AnswerModelMetadata }) {
  const [open, setOpen] = useState(false);
  if (!metadata) return null;
  const tokens = (metadata.inputTokens ?? 0) + (metadata.outputTokens ?? 0);
  const cost = formatMoney(metadata.costUsd);
  const latency = formatLatency(metadata.latencyMs);
  const summaryBits = [
    metadata.displayName || metadata.modelId,
    metadata.webSourcesCount ? `${metadata.webSourcesCount} sources` : undefined,
    tokens > 0 ? `${tokens.toLocaleString()} tok` : undefined,
    cost,
  ].filter(Boolean);
  return (
    <div style={{ marginTop: 2 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-hint)',
          fontSize: 11,
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <Icon name="chevronDown" size={12} stroke={1.7} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .16s' }} />
        <span>{summaryBits.join(' · ')}</span>
      </button>
      {open && (
        <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span className="pill">Model: {metadata.modelId}</span>
          <span className="pill">Provider: {metadata.provider}</span>
          {metadata.searchProvider && <span className="pill">Search: {metadata.searchProvider}</span>}
          {metadata.searchStrategy && <span className="pill">Route: {metadata.searchStrategy}</span>}
          {metadata.tier && <span className="pill">Tier: {metadata.tier}</span>}
          {latency && <span className="pill">Latency: {latency}</span>}
          {metadata.toolsUsed.length > 0 && <span className="pill">Tools: {metadata.toolsUsed.join(', ')}</span>}
          {metadata.quality && <span className={`pill ${metadata.quality.ok ? 'pill-green' : 'pill-amber'}`}>Web quality: {metadata.quality.ok ? 'ok' : 'needs review'}</span>}
          {metadata.searchWarnings?.map((warning, index) => (
            <span key={index} className="pill pill-amber">Reason: {warning}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function RMTable({ headers, rows, citations, sources }: { headers: string[]; rows: string[][]; citations?: SearchCitation[]; sources?: WebSource[] }) {
  return (
    <div className="rm-table-wrap">
      <table className="rm-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="rm-th">{parseInline(h.trim(), citations, sources)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 !== 0 ? 'rm-tr-alt' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="rm-td">{parseInline(cell.trim(), citations, sources)}</td>
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

export function RichMessage({
  content,
  userId,
  citations = [],
  sources = [],
  modelMetadata,
}: {
  content: string;
  userId?: string;
  citations?: SearchCitation[];
  sources?: WebSource[];
  modelMetadata?: AnswerModelMetadata;
}) {
  const blocks = parseBlocks(content);
  const renderSources = sources.length ? sources : sourcesFromSearchCitations(citations);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':    return <RMHeading      key={i} level={block.level} text={block.text} citations={citations} sources={renderSources} />;
          case 'paragraph':  return <RMParagraph    key={i} text={block.text} citations={citations} sources={renderSources} />;
          case 'bullets':    return <RMBulletList   key={i} items={block.items} citations={citations} sources={renderSources} />;
          case 'numbered':   return <RMNumberedList key={i} items={block.items} citations={citations} sources={renderSources} />;
          case 'code':
            {
              const lang = block.lang.trim().toLowerCase();
              if (lang === 'email_card') return <EmailCard key={i} raw={block.code} userId={userId} />;
              if (lang === 'calendar_event_card') return <CalendarEventCard key={i} raw={block.code} userId={userId} />;
              if (lang === 'x_post_card') return <XPostCard key={i} raw={block.code} />;
              if (lang === 'x_user_card') return <XUserCard key={i} raw={block.code} />;
              if (lang === 'x_scheduled_post_card') return <XScheduledPostCard key={i} raw={block.code} />;
              if (lang === 'copy') return <RMCopyBlock key={i} text={block.code} />;
              if (lang === 'visualization') return <VisualizationBlock key={i} html={block.code} />;
            }
            return <RMCodeBlock key={i} lang={block.lang} code={block.code} />;
          case 'blockquote': return <RMBlockquote   key={i} text={block.text} citations={citations} sources={renderSources} />;
          case 'divider':    return <RMDivider      key={i} />;
          case 'table':      return <RMTable        key={i} headers={block.headers} rows={block.rows} citations={citations} sources={renderSources} />;
          default:           return null;
        }
      })}
      <SourcesList citations={citations} sources={renderSources} />
      <ModelMetadataFooter metadata={modelMetadata} />
    </div>
  );
}
