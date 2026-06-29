const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
]);

const URI_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'poster']);

export function sanitizeVisualizationHtml(raw: string): string {
  if (typeof DOMParser === 'undefined') return sanitizeVisualizationHtmlFallback(raw);

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      element.remove();
      continue;
    }

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && /url\s*\(/i.test(value)) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (URI_ATTRS.has(name)) {
        const safeHash = value.startsWith('#');
        const safeDataImage = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value);
        if (!safeHash && !safeDataImage) element.removeAttribute(attr.name);
      }
    }
  }

  return root.innerHTML;
}

function sanitizeVisualizationHtmlFallback(raw: string): string {
  let html = raw;
  html = html.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|link|meta|base)\b[\s\S]*?<\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|link|meta|base)\b[^>]*\/?\s*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(href|src|xlink:href|formaction|poster)\s*=\s*("(?!#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)[^"]*"|'(?!#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)[^']*'|(?!#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)[^\s>]+)/gi, '');
  html = html.replace(/\s+style\s*=\s*("[^"]*url\s*\([^"]*"|'[^']*url\s*\([^']*'|[^\s>]*url\s*\([^\s>]*)/gi, '');
  return html;
}
