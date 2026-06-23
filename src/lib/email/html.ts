// Markdown → email-ready HTML. Email clients strip <style> blocks and most ignore
// class-based CSS, so every element carries INLINE styles. Authoring is markdown
// only (the AI/user never write raw HTML here), so text nodes are HTML-escaped and
// no sanitizer dependency is needed. Produces a clean, "designed" business email:
// a centered 600px column, readable typography, styled headings/lists/quotes/links.

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

const STYLE = {
  container: `max-width:600px;margin:0 auto;padding:8px 4px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1a1a1a;`,
  h1: 'margin:0 0 14px;font-size:23px;line-height:1.25;font-weight:700;color:#0f1115;',
  h2: 'margin:22px 0 10px;font-size:19px;line-height:1.3;font-weight:700;color:#0f1115;',
  h3: 'margin:18px 0 8px;font-size:16px;line-height:1.35;font-weight:700;color:#0f1115;',
  p: 'margin:0 0 14px;',
  ul: 'margin:0 0 14px;padding-left:22px;',
  ol: 'margin:0 0 14px;padding-left:22px;',
  li: 'margin:0 0 6px;',
  blockquote: 'margin:0 0 14px;padding:8px 14px;border-left:3px solid #d0d7de;color:#57606a;background:#f6f8fa;',
  hr: 'border:none;border-top:1px solid #e1e4e8;margin:20px 0;',
  a: 'color:#2563eb;text-decoration:underline;',
  code: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f3f4f6;padding:1px 5px;border-radius:4px;',
  strong: 'font-weight:700;',
  em: 'font-style:italic;',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a URL for an href attribute, allowing only http(s) and mailto. */
function safeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return escapeHtml(trimmed);
  return '#';
}

/** Convert inline markdown (bold/italic/code/link) in an already-block-split line. */
function renderInline(text: string): string {
  // Tokenize on the inline markers, escaping the literal text around them. Code
  // spans win first so their contents are not re-parsed.
  const parts: string[] = [];
  let rest = text;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/;
  while (rest.length) {
    const m = rest.match(pattern);
    if (!m || m.index === undefined) { parts.push(escapeHtml(rest)); break; }
    if (m.index > 0) parts.push(escapeHtml(rest.slice(0, m.index)));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(`<code style="${STYLE.code}">${escapeHtml(tok.slice(1, -1))}</code>`);
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      parts.push(`<strong style="${STYLE.strong}">${escapeHtml(tok.slice(2, -2))}</strong>`);
    } else if (tok.startsWith('[')) {
      const linkMatch = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      parts.push(`<a href="${safeHref(linkMatch[2])}" style="${STYLE.a}">${escapeHtml(linkMatch[1])}</a>`);
    } else {
      parts.push(`<em style="${STYLE.em}">${escapeHtml(tok.slice(1, -1))}</em>`);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return parts.join('');
}

interface Block { type: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'ol' | 'blockquote' | 'hr'; lines: string[] }

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', lines: [para.join(' ')] }); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flushPara(); continue; }
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) { flushPara(); blocks.push({ type: 'hr', lines: [] }); continue; }
    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); blocks.push({ type: h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3', lines: [h[2]] }); continue; }
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { quote.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      i--;
      blocks.push({ type: 'blockquote', lines: quote });
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*+]\s+/, '')); i++; }
      i--;
      blocks.push({ type: 'ul', lines: items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++; }
      i--;
      blocks.push({ type: 'ol', lines: items });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'h1': return `<h1 style="${STYLE.h1}">${renderInline(block.lines[0])}</h1>`;
    case 'h2': return `<h2 style="${STYLE.h2}">${renderInline(block.lines[0])}</h2>`;
    case 'h3': return `<h3 style="${STYLE.h3}">${renderInline(block.lines[0])}</h3>`;
    case 'hr': return `<hr style="${STYLE.hr}" />`;
    case 'blockquote': return `<blockquote style="${STYLE.blockquote}">${block.lines.map(renderInline).join('<br />')}</blockquote>`;
    case 'ul': return `<ul style="${STYLE.ul}">${block.lines.map((l) => `<li style="${STYLE.li}">${renderInline(l)}</li>`).join('')}</ul>`;
    case 'ol': return `<ol style="${STYLE.ol}">${block.lines.map((l) => `<li style="${STYLE.li}">${renderInline(l)}</li>`).join('')}</ol>`;
    case 'p':
    default: return `<p style="${STYLE.p}">${renderInline(block.lines[0])}</p>`;
  }
}

/** Render the body (markdown) to the inline-styled email container only (no
 * <html>/<head> wrapper). Safe to inject into a chat preview surface. */
export function markdownToEmailInnerHtml(markdown: string): string {
  const body = parseBlocks(markdown ?? '').map(renderBlock).join('\n');
  return `<div style="${STYLE.container}">${body}</div>`;
}

/** Render the body (markdown) to a full inline-styled HTML email document. */
export function markdownToEmailHtml(markdown: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;">${markdownToEmailInnerHtml(markdown)}</body></html>`;
}

/** A readable plain-text rendering of the same markdown (multipart fallback). */
export function markdownToPlainText(markdown: string): string {
  return parseBlocks(markdown ?? '')
    .map((block) => {
      const inline = (s: string) => s
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/_([^_\n]+)_/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
      switch (block.type) {
        case 'hr': return '----------';
        case 'ul': return block.lines.map((l) => `• ${inline(l)}`).join('\n');
        case 'ol': return block.lines.map((l, i) => `${i + 1}. ${inline(l)}`).join('\n');
        case 'blockquote': return block.lines.map((l) => `> ${inline(l)}`).join('\n');
        default: return inline(block.lines[0] ?? '');
      }
    })
    .join('\n\n')
    .trim();
}
