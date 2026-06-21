import { describe, expect, it } from 'vitest';
import {
  assembleDeck, buildBrief, buildSampleLarundDeck, detectSlideCount, detectTone,
} from '../planner';
import { PRESENTATION_THEMES, defaultThemeFor, getPresentationTheme } from '../themes';
import { layoutForSlide, renderSlideInner, LAYOUT_IDS } from '../layouts';
import { renderPresentationHtml } from '../preview';
import { lintPresentation } from '../quality-lint';
import type { DeckSlide } from '../types';

describe('presentation planner', () => {
  it('detects requested slide count', () => {
    expect(detectSlideCount('Készíts egy 5 diás prezentációt')).toBe(5);
    expect(detectSlideCount('make a 8 slide deck')).toBe(8);
    expect(detectSlideCount('prezentáció a Larundról')).toBeUndefined();
  });

  it('builds a brief with smart defaults and tone detection', () => {
    const brief = buildBrief('Készíts egy pitch decket a Larundról');
    expect(brief.tone).toBe('startup');
    expect(brief.aspectRatio).toBe('16:9');
    expect(brief.language).toBe('hu');
    expect(brief.themeId).toBeTruthy();
    expect(detectTone('oktató prezentáció')).toBe('educational');
  });

  it('assembles a deck with a resolved theme and brand palette', () => {
    const deck = assembleDeck({
      title: 'Teszt', themeId: 'corporate-blue',
      slides: [{ type: 'title', title: 'Teszt' }, { type: 'closing', title: 'Vége' }],
    });
    expect(deck.theme.id).toBe('corporate-blue');
    expect(deck.theme.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(deck.brand?.accent).toBe(deck.theme.accent);
    expect(deck.metadata.actualSlideCount).toBe(2);
  });
});

describe('presentation themes + layouts', () => {
  it('ships the requested themes and ≥8 layouts', () => {
    for (const id of ['larund-dark', 'premium-dark', 'modern-light', 'corporate-blue', 'startup-orange', 'technical-minimal', 'elegant-white'] as const) {
      expect(PRESENTATION_THEMES[id]).toBeTruthy();
    }
    expect(LAYOUT_IDS.length).toBeGreaterThanOrEqual(8);
    expect(defaultThemeFor('technical', 'inform')).toBe('technical-minimal');
    expect(defaultThemeFor('startup', 'pitch')).toBe('startup-orange');
  });

  it('renders partial / legacy slides without throwing (viewer robustness)', () => {
    const theme = getPresentationTheme('larund-dark');
    const opts = { index: 0, total: 1, deckTitle: 'Deck' };
    // Missing arrays (cards/items/steps/rows) must not crash the renderer.
    const partial = [
      { type: 'cards', title: 'No cards' },
      { type: 'metrics', title: 'No metrics' },
      { type: 'timeline', title: 'No steps' },
      { type: 'comparison', title: 'No rows' },
      { type: 'bullets', title: 'No bullets' },
    ] as unknown as DeckSlide[];
    for (const slide of partial) {
      const html = renderSlideInner(slide, theme, opts);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it('assigns a layout to every slide type and renders themed HTML with escaping', () => {
    const theme = getPresentationTheme('larund-dark');
    const slide: DeckSlide = { type: 'cards', title: 'A & B <x>', cards: [{ title: 'X', body: 'Y', icon: 'rocket' }] };
    expect(layoutForSlide(slide)).toBe('cards-grid');
    const html = renderSlideInner(slide, theme, { index: 1, total: 3, deckTitle: 'Deck' });
    expect(html).toContain('A &amp; B &lt;x&gt;');
    expect(html).toContain(theme.accent);
    expect(html.length).toBeGreaterThan(200);
  });
});

describe('presentation preview', () => {
  it('renders a real, themed, scrollable HTML preview from the model', () => {
    const deck = buildSampleLarundDeck();
    const html = renderPresentationHtml(deck);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('scaleStages');
    expect((html.match(/class="stage"/g) ?? []).length).toBe(5);
    // accented content survives
    expect(html).toContain('Ellenőrzés');
    expect(html).toContain(deck.theme.accent);
  });
});

describe('presentation quality lint', () => {
  it('passes the designed sample deck', () => {
    const result = lintPresentation(buildSampleLarundDeck());
    expect(result.status).not.toBe('fail');
    expect(result.slideCount).toBe(5);
  });

  it('fails when the slide count does not match the request', () => {
    const deck = buildSampleLarundDeck();
    const result = lintPresentation(deck, 7);
    expect(result.status).toBe('fail');
    expect(result.failures).toContain('slide_count');
  });

  it('fails an untitled / skeleton deck', () => {
    const deck = assembleDeck({
      title: 'Bad', themeId: 'larund-dark',
      slides: [{ type: 'bullets', title: '', bullets: ['x'] }, { type: 'bullets', title: '', bullets: ['y'] }],
    });
    const result = lintPresentation(deck);
    expect(result.status).toBe('fail');
    expect(result.failures).toContain('every_slide_titled');
  });

  it('flags Hungarian decks with no accents', () => {
    const deck = assembleDeck({
      title: 'No accents', language: 'hu', themeId: 'larund-dark',
      slides: [{ type: 'title', title: 'Hello World' }, { type: 'closing', title: 'Bye' }],
    });
    const result = lintPresentation(deck);
    expect(result.failures).toContain('accents_present');
  });
});
