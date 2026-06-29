import { describe, expect, it } from 'vitest';
import { sanitizeVisualizationHtml } from '../rich-format';

describe('visualization html sanitizer', () => {
  it('removes scripts, forms, handlers, and external resource URLs', () => {
    const html = sanitizeVisualizationHtml(`
      <script>alert(1)</script>
      <form><input value="x"></form>
      <svg onclick="bad()"><a href="https://evil.test"><rect width="10" /></a></svg>
      <div style="background:url(https://evil.test/a.png); color:red">ok</div>
    `);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('https://evil.test');
    expect(html).toContain('ok');
  });
});

