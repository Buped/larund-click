import { describe, it, expect } from 'vitest';
import { buildDailySummaryContent, dueForDailySummary, localDateKey, type DailySources } from '../daily-summary';
import { defaultMemorySettings } from '../settings';

const sources: DailySources = {
  date: '2026-06-19',
  chats: [{ title: 'Invoice filing', userMessages: ['Sort my invoices and log them'] }],
  completedTasks: [{ title: 'Bookkeeping log', summary: 'Created Konyvelesi_Naplo.xlsx and verified rows', outputs: ['Konyvelesi_Naplo.xlsx'] }],
  openTasks: ['Send client report (blocked)'],
  corrections: ['Always read the file back before completing'],
  newFacts: ['Kovács Dental — tone'],
};

describe('buildDailySummaryContent', () => {
  it('renders all six sections', () => {
    const md = buildDailySummaryContent(sources);
    expect(md).toMatch(/### What we worked on/);
    expect(md).toMatch(/### Important decisions/);
    expect(md).toMatch(/### New client\/project facts/);
    expect(md).toMatch(/### Open tasks/);
    expect(md).toMatch(/### Corrections\/preferences learned/);
    expect(md).toMatch(/### Follow-ups for tomorrow/);
  });

  it('includes real content from sources', () => {
    const md = buildDailySummaryContent(sources);
    expect(md).toMatch(/Bookkeeping log/);
    expect(md).toMatch(/Kovács Dental/);
    expect(md).toMatch(/read the file back/);
  });

  it('uses an em dash placeholder for empty sections', () => {
    const empty: DailySources = { date: '2026-06-19', chats: [], completedTasks: [], openTasks: [], corrections: [], newFacts: [] };
    expect(buildDailySummaryContent(empty)).toMatch(/- —/);
  });
});

describe('dueForDailySummary', () => {
  const settings = { ...defaultMemorySettings(), dailySummary: true, dailySummaryTime: '22:00' };

  it('is due after the configured time when not yet run today', () => {
    const now = new Date('2026-06-19T22:30:00');
    const r = dueForDailySummary(now, settings);
    expect(r.due).toBe(true);
    expect(r.date).toBe('2026-06-19');
  });

  it('is not due before the configured time', () => {
    expect(dueForDailySummary(new Date('2026-06-19T21:00:00'), settings).due).toBe(false);
  });

  it('is not due if already run today', () => {
    const now = new Date('2026-06-19T23:00:00');
    expect(dueForDailySummary(now, settings, '2026-06-19').due).toBe(false);
  });

  it('is not due when the feature is off', () => {
    const off = { ...settings, dailySummary: false };
    expect(dueForDailySummary(new Date('2026-06-19T23:00:00'), off).due).toBe(false);
  });

  it('localDateKey is local, zero-padded', () => {
    expect(localDateKey(new Date('2026-01-05T10:00:00'))).toBe('2026-01-05');
  });
});
