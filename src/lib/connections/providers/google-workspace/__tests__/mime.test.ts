import { describe, expect, it } from 'vitest';
import { buildRawMessage } from '../gmail';
import { markdownToEmailHtml } from '../../../../email/html';

/** Decode the base64url raw message back to its RFC822 text. */
function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

describe('buildRawMessage', () => {
  it('builds a plain-text message when no html is given', () => {
    const msg = decodeRaw(buildRawMessage('a@b.com', 'Tárgy', 'Szia'));
    expect(msg).toContain('To: a@b.com');
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).not.toContain('multipart/alternative');
  });

  it('builds multipart/alternative with both plain and HTML parts', () => {
    const html = markdownToEmailHtml('# Szia\n\nEz **fontos**.');
    const msg = decodeRaw(buildRawMessage('a@b.com', 'Tárgy', 'Szia\n\nEz fontos.', { cc: 'c@d.com', html }));
    expect(msg).toContain('To: a@b.com');
    expect(msg).toContain('Cc: c@d.com');
    expect(msg).toContain('Content-Type: multipart/alternative; boundary=');
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).toContain('Content-Type: text/html; charset="UTF-8"');
    // The HTML part's base64 should decode back to our HTML document.
    const htmlPart = msg.split('text/html; charset="UTF-8"')[1] ?? '';
    const b64 = htmlPart.split('\r\n').find((l) => l.length > 40) ?? '';
    expect(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')).toContain('<h1');
  });
});
