// Presentation Intelligence — data models.
//
// One `PresentationDeckModel` drives every surface: the Rust OOXML renderer, the
// in-app HTML/React preview, the quality lint, and the artifact card. A deck is a
// visual story, not a document split into pages — so slides carry an explicit
// layout/type and a single message, never a free dump of text.

import type { BrandTheme } from '../types';

export type DeckGoal =
  | 'inform' | 'teach' | 'sell' | 'pitch' | 'report'
  | 'persuade' | 'summarize' | 'demo' | 'strategy';

export type DeckTone =
  | 'premium' | 'minimal' | 'corporate' | 'startup'
  | 'technical' | 'educational' | 'bold' | 'elegant';

export interface PresentationBrief {
  title: string;
  topic: string;
  audience: string;
  goal: DeckGoal;
  language: string;
  requestedSlideCount?: number;
  tone: DeckTone;
  aspectRatio: '16:9' | '4:3';
  themeId?: PresentationThemeId;
  mustInclude?: string[];
  avoid?: string[];
}

export type StoryArc =
  | 'problem-solution' | 'before-after' | 'three-act'
  | 'executive-briefing' | 'educational' | 'demo-flow' | 'status-report';

export interface NarrativeOutline {
  coreMessage: string;
  audienceTakeaway: string;
  storyArc: StoryArc;
  sections: Array<{ title: string; purpose: string; keyPoints: string[] }>;
}

export type SlideType =
  | 'title' | 'agenda' | 'section' | 'bullets' | 'cards'
  | 'timeline' | 'process' | 'metrics' | 'comparison' | 'quote' | 'closing';

export interface DeckCard { title: string; body: string; icon?: IconName }
export interface DeckStep { label?: string; title: string; body: string }
export interface DeckMetric { value: string; label: string; note?: string }

interface SlideBase {
  type: SlideType;
  kicker?: string;
  /** Speaker note — optional, never shown on the slide face. */
  note?: string;
}

export type DeckSlide =
  | (SlideBase & { type: 'title'; title: string; subtitle?: string })
  | (SlideBase & { type: 'agenda'; title: string; items: string[] })
  | (SlideBase & { type: 'section'; title: string; subtitle?: string; marker?: string })
  | (SlideBase & { type: 'bullets'; title: string; bullets: string[] })
  | (SlideBase & { type: 'cards'; title: string; cards: DeckCard[] })
  | (SlideBase & { type: 'timeline'; title: string; steps: DeckStep[] })
  | (SlideBase & { type: 'process'; title: string; steps: DeckStep[] })
  | (SlideBase & { type: 'metrics'; title: string; items: DeckMetric[] })
  | (SlideBase & { type: 'comparison'; title: string; columns: string[]; rows: string[][] })
  | (SlideBase & { type: 'quote'; quote: string; author?: string })
  | (SlideBase & { type: 'closing'; title: string; subtitle?: string; cta?: string });

export type IconName =
  | 'rocket' | 'brain' | 'database' | 'shield' | 'document'
  | 'chart' | 'workflow' | 'check' | 'warning' | 'spark' | 'gear' | 'people';

/** Flat color + type tokens shared by the OOXML and HTML renderers. */
export interface PresentationTheme {
  id: PresentationThemeId;
  name: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  accent: string;
  text: string;
  mutedText: string;
  border: string;
  onAccent: string;
  fontHeading: string;
  fontBody: string;
  radius: number;
  dark: boolean;
}

export type PresentationThemeId =
  | 'larund-dark' | 'premium-dark' | 'modern-light'
  | 'corporate-blue' | 'startup-orange' | 'technical-minimal' | 'elegant-white';

export interface PresentationDeckModel {
  kind: 'presentation';
  id?: string;
  title: string;
  subtitle?: string;
  language: string;
  aspectRatio: '16:9' | '4:3';
  themeId: PresentationThemeId;
  /** Resolved theme colors so the Rust renderer needs no theme registry. */
  theme: PresentationTheme;
  designQuality: 'standard' | 'premium';
  slides: DeckSlide[];
  /** Compatibility palette for shared document tooling. */
  brand?: BrandTheme;
  metadata: {
    createdAt: string;
    requestedSlideCount?: number;
    actualSlideCount: number;
    storyArc?: StoryArc;
    source?: string;
  };
}

export interface SlideStoryboard {
  title: string;
  subtitle?: string;
  themeId: PresentationThemeId;
  slides: DeckSlide[];
}
