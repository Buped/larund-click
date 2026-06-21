// Presentation planner — request → brief → (outline) → storyboard → deck model.
// The agent authors slide content; these helpers supply smart defaults, slide-count
// detection, theme resolution, and deterministic deck assembly so a request like
// "Készíts egy 5 diás prezentációt …" reliably yields a designed, themed deck.

import type {
  DeckGoal, DeckSlide, DeckTone, PresentationBrief, PresentationDeckModel,
  PresentationThemeId, SlideStoryboard,
} from './types';
import { defaultThemeFor, getPresentationTheme, presentationThemeToBrand } from './themes';

export function detectSlideCount(request: string): number | undefined {
  const m = request.match(/(\d+)\s*(di[aá]s|di[aá]t|slides?|slide|oldalas)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 40) return n;
  }
  return undefined;
}

export function detectTone(request: string): DeckTone {
  const t = request.toLowerCase();
  if (/\b(pitch|startup|befektet|invest)/.test(t)) return 'startup';
  if (/\b(oktat|tan[ií]t|educational|tutorial|kurzus|magyar[aá]z)/.test(t)) return 'educational';
  if (/\b(technical|technikai|architektúra|architecture|fejleszt|developer|api)/.test(t)) return 'technical';
  if (/\b(üzleti|business|vállalati|corporate|jelent|report)/.test(t)) return 'corporate';
  if (/\b(elegáns|elegant|minimal|letisztult)/.test(t)) return 'elegant';
  return 'premium';
}

export function detectGoal(request: string): DeckGoal {
  const t = request.toLowerCase();
  if (/\bpitch\b/.test(t)) return 'pitch';
  if (/\b(oktat|tan[ií]t|educational|tutorial)/.test(t)) return 'teach';
  if (/\b(jelent|report|státusz|status)/.test(t)) return 'report';
  if (/\b(elad|sell|sales|ajánlat)/.test(t)) return 'sell';
  if (/\b(stratég|strategy)/.test(t)) return 'strategy';
  if (/\b(demo|bemutat)/.test(t)) return 'demo';
  return 'inform';
}

export function buildBrief(request: string, overrides: Partial<PresentationBrief> = {}): PresentationBrief {
  const tone = overrides.tone ?? detectTone(request);
  const goal = overrides.goal ?? detectGoal(request);
  const language = overrides.language ?? (/[áéíóöőúüű]/i.test(request) ? 'hu' : 'en');
  return {
    title: overrides.title ?? inferTitle(request),
    topic: overrides.topic ?? request.trim().slice(0, 160),
    audience: overrides.audience ?? 'általános üzleti/technikai közönség',
    goal,
    language,
    requestedSlideCount: overrides.requestedSlideCount ?? detectSlideCount(request),
    tone,
    aspectRatio: overrides.aspectRatio ?? '16:9',
    themeId: overrides.themeId ?? defaultThemeFor(tone, goal),
    mustInclude: overrides.mustInclude,
    avoid: overrides.avoid,
  };
}

function inferTitle(request: string): string {
  const normalized = request.trim().replace(/\s+/g, ' ');
  const withoutLead = normalized.replace(/^(k[eé]sz[ií]ts|csin[aá]lj|generate|create|make)\s+(egy\s+)?/i, '');
  return withoutLead.slice(0, 70) || 'Prezentáció';
}

export interface AssembleDeckInput {
  title: string;
  subtitle?: string;
  language?: string;
  themeId?: PresentationThemeId;
  slides: DeckSlide[];
  requestedSlideCount?: number;
  source?: string;
}

/** Assemble a render-ready deck model with a resolved theme + brand palette. */
export function assembleDeck(input: AssembleDeckInput): PresentationDeckModel {
  const themeId = input.themeId ?? 'larund-dark';
  const theme = getPresentationTheme(themeId);
  return {
    kind: 'presentation',
    title: input.title,
    subtitle: input.subtitle,
    language: input.language ?? 'hu',
    aspectRatio: '16:9',
    themeId,
    theme,
    designQuality: 'premium',
    slides: input.slides,
    brand: presentationThemeToBrand(theme),
    metadata: {
      createdAt: new Date().toISOString(),
      requestedSlideCount: input.requestedSlideCount,
      actualSlideCount: input.slides.length,
      source: input.source,
    },
  };
}

export function storyboardToDeck(storyboard: SlideStoryboard, language = 'hu'): PresentationDeckModel {
  return assembleDeck({
    title: storyboard.title,
    subtitle: storyboard.subtitle,
    language,
    themeId: storyboard.themeId,
    slides: storyboard.slides,
  });
}

/**
 * Deterministic 5-slide reference deck for
 * "Készíts egy 5 diás prezentációt a Larund vibe-coder munkafolyamatról."
 * Exercises title + cards + timeline + metrics + closing layouts.
 */
export function buildSampleLarundDeck(): PresentationDeckModel {
  const slides: DeckSlide[] = [
    {
      type: 'title',
      kicker: 'LARUND CLICK',
      title: 'A Larund vibe-coder munkafolyamat',
      subtitle: 'Ötlettől működő funkcióig — egyetlen természetes nyelvű beszélgetésben.',
    },
    {
      type: 'cards',
      title: 'Mit ad a Larund?',
      kicker: 'ÁTTEKINTÉS',
      cards: [
        { title: 'Szándék-vezérelt', body: 'Elmondod, mit szeretnél; a Larund tervet készít és végrehajtja.', icon: 'brain' },
        { title: 'Eszközök & skillek', body: 'Fájlok, böngésző, dokumentumok és kapcsolatok egy helyen.', icon: 'workflow' },
        { title: 'Ellenőrzött eredmény', body: 'Minden lépést igazol, mielőtt késznek jelölné.', icon: 'check' },
      ],
    },
    {
      type: 'timeline',
      title: 'A munkafolyamat öt lépése',
      kicker: 'FOLYAMAT',
      steps: [
        { label: '01', title: 'Kérés', body: 'Természetes nyelvű cél megfogalmazása.' },
        { label: '02', title: 'Terv', body: 'A Larund lépésekre bontja a feladatot.' },
        { label: '03', title: 'Végrehajtás', body: 'Eszközök és skillek futtatása.' },
        { label: '04', title: 'Ellenőrzés', body: 'Eredmény visszaolvasása és igazolása.' },
        { label: '05', title: 'Kész', body: 'Artifact és összefoglaló átadása.' },
      ],
    },
    {
      type: 'metrics',
      title: 'Miért gyorsabb így?',
      kicker: 'HATÁS',
      items: [
        { value: '5x', label: 'gyorsabb prototípus', note: 'kézi kódolás helyett' },
        { value: '0', label: 'kontextusváltás', note: 'minden egy felületen' },
        { value: '100%', label: 'ellenőrzött lépés', note: 'completion guard' },
      ],
    },
    {
      type: 'closing',
      kicker: 'KEZDJÜK EL',
      title: 'Építsd a következő funkciót beszélgetve.',
      subtitle: 'A Larund Click a vibe-coder munkafolyamatot mindennapi gyakorlattá teszi.',
      cta: 'Próbáld ki most',
    },
  ];
  return assembleDeck({ title: 'A Larund vibe-coder munkafolyamat', themeId: 'larund-dark', slides, requestedSlideCount: 5, source: 'sample' });
}
