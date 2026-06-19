// Local fixture server for the Larund Operator Benchmarks. No dependencies — runs on
// the Node bundled with the toolchain. Serves the static mock sites in ./public and
// adds a few dynamic routes (a downloadable invoice with the correct attachment
// header, a generated valid PDF, and a form-submit endpoint). These are MOCKS for
// runtime smoke testing only — never point benchmarks at a real customer site.
//
//   node demo-sites/operator-benchmarks/serve.mjs            # port 8787
//   PORT=9000 node demo-sites/operator-benchmarks/serve.mjs  # custom port

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const INVOICE_TEXT = [
  'ACME Kft. — SZÁMLA / INVOICE',
  'Számlaszám / Invoice no: ACME-2026-06-0042',
  'Dátum / Date: 2026-06-15',
  'Szolgáltató / Vendor: ACME Kft.',
  'Vevő / Customer: Larund Demo Bt.',
  'Összeg / Amount: 125 000 HUF',
  'Pénznem / Currency: HUF',
  'Kategória / Category: Software subscription',
  'Fizetési határidő / Due: 2026-06-30',
  '',
  'Köszönjük, hogy minket választott! / Thank you for your business.',
].join('\n');

// Generic PDF assembler with correct xref offsets. Each object is either
// `{ body }` (plain) or `{ dict, stream }` (a stream with binary content).
function buildPdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(pos);
    const chunk = o.stream
      ? Buffer.concat([
          Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'),
          o.stream,
          Buffer.from('\nendstream\nendobj\n', 'latin1'),
        ])
      : Buffer.from(`${i + 1} 0 obj\n${o.body}\nendobj\n`, 'latin1');
    parts.push(chunk);
    pos += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const INVOICE_LINES = [
  'Invoice ACME-2026-06-0042',
  'Date: 2026-06-15',
  'Vendor: ACME Kft.',
  'Amount: 125000 HUF',
  'Currency: HUF',
  'Category: Software subscription',
];

/** A real-world text PDF: the content stream is FlateDecode-compressed (the case the
 *  old literal scanner could not read; pdf-extract handles it). */
function buildCompressedInvoicePdf() {
  let content = 'BT /F1 12 Tf 72 760 Td 16 TL\n';
  for (const l of INVOICE_LINES) content += `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*\n`;
  content += 'ET';
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  return buildPdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>' },
    { dict: `<< /Length ${stream.length} /Filter /FlateDecode >>`, stream },
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
}

// A minimal valid baseline JPEG (used to make a "scanned" page). Tiny on purpose — the
// fixture proves the embedded-image → vision pipeline, not OCR accuracy.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q==',
  'base64',
);

/** A "scanned" PDF: a single page whose only content is a DCTDecode (JPEG) image.
 *  There is no text layer, so the operator must fall back to reading the page image
 *  with vision. */
function buildScannedInvoicePdf() {
  const content = Buffer.from('q 612 0 0 792 0 0 cm /Im0 Do Q', 'latin1');
  return buildPdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>' },
    { dict: `<< /Length ${content.length} >>`, stream: content },
    { dict: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${TINY_JPEG.length} >>`, stream: TINY_JPEG },
  ]);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    // ── Dynamic routes ──────────────────────────────────────────────────────
    if (path === '/portal/invoice.pdf') {
      // Real-world text PDF: FlateDecode-compressed content stream.
      return send(res, 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="invoice-acme-2026-06.pdf"',
      }, buildCompressedInvoicePdf());
    }
    if (path === '/portal/invoice-scanned.pdf') {
      // Scanned/image-only PDF: no text layer → read via vision fallback.
      return send(res, 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="invoice-scanned-2026-06.pdf"',
      }, buildScannedInvoicePdf());
    }
    if (path === '/portal/invoice.txt') {
      return send(res, 200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="invoice-acme-2026-06.txt"',
      }, INVOICE_TEXT);
    }
    if (req.method === 'POST' && path === '/form/submit') {
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' },
        '<!doctype html><meta charset=utf-8><title>Submitted</title><body style="font-family:system-ui;padding:40px"><h1 id="result">Form submitted successfully</h1><p>The demo form was received.</p></body>');
    }

    // ── Static files from ./public ──────────────────────────────────────────
    let rel = path === '/' ? '/index.html' : path;
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = normalize(join(PUBLIC, rel));
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, { 'Content-Type': 'text/plain' }, `Not found: ${rel}`);
    const data = await readFile(filePath);
    return send(res, 200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' }, data);
  } catch (err) {
    return send(res, 500, { 'Content-Type': 'text/plain' }, `Server error: ${err}`);
  }
});

server.listen(PORT, () => {
  console.log(`Larund benchmark fixtures: http://localhost:${PORT}/`);
  console.log('  Hub:        /');
  console.log('  Portal:     /portal/login.html   (login demo / demo123)');
  console.log('  Form:       /form/');
  console.log('  Upload:     /upload/');
  console.log('  Table:      /table/');
  console.log('  Admin:      /admin/');
});
