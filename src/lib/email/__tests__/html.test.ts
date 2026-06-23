import { describe, expect, it } from 'vitest';
import { markdownToEmailHtml, markdownToEmailInnerHtml, markdownToPlainText } from '../html';

describe('markdownToEmailHtml', () => {
  it('renders headings, bold, italic and lists with inline styles', () => {
    const html = markdownToEmailInnerHtml('# Cím\n\nEz **fontos** és *dőlt*.\n\n- egy\n- kettő');
    expect(html).toContain('<h1');
    expect(html).toContain('Cím');
    expect(html).toContain('<strong');
    expect(html).toContain('fontos');
    expect(html).toContain('<em');
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    // inline styles, not classes (email clients strip <style>)
    expect(html).toContain('style=');
    expect(html).not.toContain('class=');
  });

  it('preserves Hungarian accents', () => {
    const html = markdownToEmailInnerHtml('Üdvözöllek, Péter! Árvíztűrő tükörfúrógép.');
    expect(html).toContain('Üdvözöllek');
    expect(html).toContain('Árvíztűrő tükörfúrógép');
  });

  it('renders links only for http(s)/mailto and escapes HTML', () => {
    const ok = markdownToEmailInnerHtml('[Larund](https://larund.com)');
    expect(ok).toContain('href="https://larund.com"');
    const bad = markdownToEmailInnerHtml('[x](javascript:alert(1))');
    expect(bad).toContain('href="#"');
    expect(bad).not.toContain('javascript:');
    const escaped = markdownToEmailInnerHtml('5 < 10 & "ok"');
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&amp;');
  });

  it('wraps a full document for sending', () => {
    const doc = markdownToEmailHtml('Hello');
    expect(doc).toMatch(/^<!doctype html>/i);
    expect(doc).toContain('<body');
  });
});

describe('markdownToPlainText', () => {
  it('strips markdown markers', () => {
    const text = markdownToPlainText('# Cím\n\nEz **fontos**.\n\n- egy\n- kettő');
    expect(text).toContain('Cím');
    expect(text).toContain('Ez fontos.');
    expect(text).toContain('• egy');
    expect(text).not.toContain('**');
    expect(text).not.toContain('#');
  });
});
