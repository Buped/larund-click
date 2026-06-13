import React, { useState } from 'react';

// ─── Inline parser ─────────────────────────────────────────────────────────────
// Handles: **bold**, __bold__, *italic*, _italic_, `code`, [link](url)
// Unmatched * or _ are stripped.

function parseInline(text: string): React.ReactNode[] {
  const PAT = /\*\*(.+?)\*\*|__(.+?)__|[*_]([^*_\n]+?)[*_]|`([^`\n]+?)`|\[([^\]]+)\]\(([^)\n]+)\)/g;
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
          background: 'rgba(74,158,255,0.13)', color: '#7BBFFF',
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

function RMHeading({ level, text }: { level: number; text: string }) {
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
      {parseInline(text)}
    </div>
  );
}

function RMParagraph({ text }: { text: string }) {
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: 'inherit', lineHeight: 1.75 }}>
      {text.split('\n').map((line, i, arr) => (
        <React.Fragment key={i}>
          {parseInline(line)}
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

function RenderBulletItem({ item }: { item: BulletItem }) {
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent)', flex: 'none', fontSize: 6, lineHeight: 1, marginTop: 7 }}>●</span>
        <span style={{ fontSize: 13.5, color: 'inherit', lineHeight: 1.7 }}>
          {parseInline(item.text)}
        </span>
      </div>
      {item.children.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {item.children.map((child, i) => <RenderBulletItem key={i} item={child} />)}
        </ul>
      )}
    </li>
  );
}

function RMBulletList({ items }: { items: string[] }) {
  const tree = buildBulletTree(items);
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tree.map((item, i) => <RenderBulletItem key={i} item={item} />)}
    </ul>
  );
}

function RMNumberedList({ items }: { items: string[] }) {
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
              {parseInline(raw)}
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

function RMBlockquote({ text }: { text: string }) {
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
            {parseInline(line)}
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

// ── Table ─────────────────────────────────────────────────────────────────────
function RMTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rm-table-wrap">
      <table className="rm-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="rm-th">{parseInline(h.trim())}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 !== 0 ? 'rm-tr-alt' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="rm-td">{parseInline(cell.trim())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Block parser ──────────────────────────────────────────────────────────────

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'blockquote'; text: string }
  | { type: 'divider' }
  | { type: 'table'; headers: string[]; rows: string[][] };

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

export function RichMessage({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':    return <RMHeading      key={i} level={block.level} text={block.text} />;
          case 'paragraph':  return <RMParagraph    key={i} text={block.text} />;
          case 'bullets':    return <RMBulletList   key={i} items={block.items} />;
          case 'numbered':   return <RMNumberedList key={i} items={block.items} />;
          case 'code':       return <RMCodeBlock    key={i} lang={block.lang} code={block.code} />;
          case 'blockquote': return <RMBlockquote   key={i} text={block.text} />;
          case 'divider':    return <RMDivider      key={i} />;
          case 'table':      return <RMTable        key={i} headers={block.headers} rows={block.rows} />;
          default:           return null;
        }
      })}
    </div>
  );
}
