// Presentation quality lint — the content + design gate. A deck that is only
// placeholder text, overstuffed, untitled, or missing a title/closing slide must
// not be marked complete. Mirrors the document design_lint shape (pass/warn/fail).

import type { DeckSlide, PresentationDeckModel } from './types';

export interface PresentationLintCheck {
  id: string;
  ok: boolean;
  severity: 'fail' | 'warn';
  detail: string;
}

export interface PresentationLintResult {
  status: 'pass' | 'warn' | 'fail';
  failures: string[];
  warnings: string[];
  slideCount: number;
  checks: PresentationLintCheck[];
}

const HU_ACCENTS = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

function slideTitle(s: DeckSlide): string {
  return 'title' in s ? (s as { title?: string }).title ?? '' : s.type === 'quote' ? s.quote : '';
}

function slideTextLength(s: DeckSlide): number {
  switch (s.type) {
    case 'bullets': return s.bullets.join(' ').length;
    case 'cards': return s.cards.map((c) => c.title + c.body).join(' ').length;
    case 'agenda': return s.items.join(' ').length;
    default: return 0;
  }
}

function isVisualSlide(s: DeckSlide): boolean {
  return ['cards', 'timeline', 'process', 'metrics', 'comparison'].includes(s.type);
}

export function lintPresentation(model: PresentationDeckModel, expectedSlideCount?: number): PresentationLintResult {
  const checks: PresentationLintCheck[] = [];
  const add = (id: string, ok: boolean, severity: 'fail' | 'warn', detail: string) => checks.push({ id, ok, severity, detail });
  const slides = model.slides ?? [];
  const count = slides.length;

  const expected = expectedSlideCount ?? model.metadata?.requestedSlideCount;
  if (typeof expected === 'number') {
    add('slide_count', count === expected, 'fail', `expected ${expected} slides, deck has ${count}`);
  }
  add('has_slides', count >= 2, 'fail', 'a deck needs at least 2 slides');
  add('has_title_slide', slides[0]?.type === 'title', 'warn', 'first slide should be a title slide');
  add('has_closing_slide', slides.some((s) => s.type === 'closing'), 'warn', 'deck should end with a closing/CTA slide');
  add('every_slide_titled', slides.every((s) => slideTitle(s).trim().length > 0), 'fail', 'every slide must carry a title or message');
  add('has_theme', Boolean(model.theme && model.theme.background), 'fail', 'deck must have a resolved theme');
  add('every_slide_typed', slides.every((s) => Boolean(s.type)), 'fail', 'every slide must declare a layout type');

  // Not a "document split into pages": bullet-only decks are weak.
  const bulletOnly = count > 2 && slides.filter((s) => s.type === 'bullets').length >= count - 1;
  add('not_bullet_only', !bulletOnly, 'warn', 'deck is almost entirely bullet slides — add cards/timeline/metrics');
  if (count > 4) {
    add('has_visual_slides', slides.filter(isVisualSlide).length >= 2, 'warn', 'decks over 4 slides should have ≥2 visual (cards/timeline/metrics) slides');
  }

  // Overstuffed slides.
  const overstuffed = slides.find((s) => slideTextLength(s) > 600 || (s.type === 'bullets' && s.bullets.length > 6) || (s.type === 'cards' && s.cards.length > 4));
  add('not_overstuffed', !overstuffed, 'warn', 'a slide has too much content — split it (≤6 bullets, ≤4 cards)');

  // Title length / one big idea.
  const longTitle = slides.find((s) => slideTitle(s).length > 90);
  add('title_length', !longTitle, 'warn', 'a slide title exceeds 90 characters');

  // Hungarian accents survive end-to-end.
  if ((model.language ?? '').startsWith('hu')) {
    const text = slides.map((s) => JSON.stringify(s)).join(' ');
    add('accents_present', HU_ACCENTS.test(text), 'fail', 'Hungarian deck must contain accented characters');
    add('no_mojibake', !text.includes('�'), 'fail', 'deck content contains replacement characters — broken encoding');
  }

  const failures = checks.filter((c) => !c.ok && c.severity === 'fail').map((c) => c.id);
  const warnings = checks.filter((c) => !c.ok && c.severity === 'warn').map((c) => c.id);
  const status = failures.length ? 'fail' : warnings.length ? 'warn' : 'pass';
  return { status, failures, warnings, slideCount: count, checks };
}
