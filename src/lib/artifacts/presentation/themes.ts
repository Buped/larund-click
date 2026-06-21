// Presentation themes. Each theme is a flat token set consumed identically by the
// Rust OOXML renderer (colors as hex) and the HTML/React preview.

import type { BrandTheme } from '../types';
import type { DeckGoal, DeckTone, PresentationTheme, PresentationThemeId } from './types';

const HEADING = '"Segoe UI", "Inter", "Noto Sans", Arial, sans-serif';
const BODY = '"Segoe UI", "Inter", "Noto Sans", Arial, sans-serif';

function theme(t: Omit<PresentationTheme, 'fontHeading' | 'fontBody' | 'radius'> & Partial<Pick<PresentationTheme, 'radius'>>): PresentationTheme {
  return { fontHeading: HEADING, fontBody: BODY, radius: 14, ...t };
}

export const PRESENTATION_THEMES: Record<PresentationThemeId, PresentationTheme> = {
  'larund-dark': theme({
    id: 'larund-dark', name: 'Larund Dark', dark: true,
    background: '#0B0E14', surface: '#171A21', surfaceAlt: '#1F242E',
    primary: '#EE7E3A', accent: '#F4A261', text: '#F7EFE3', mutedText: '#A6AEBD',
    border: '#2A2F3A', onAccent: '#0B0E14',
  }),
  'premium-dark': theme({
    id: 'premium-dark', name: 'Premium Dark', dark: true,
    background: '#0A0A0F', surface: '#15151F', surfaceAlt: '#1E1E2C',
    primary: '#7C3AED', accent: '#22D3EE', text: '#F5F5FA', mutedText: '#A1A1B5',
    border: '#2A2A3A', onAccent: '#0A0A0F',
  }),
  'modern-light': theme({
    id: 'modern-light', name: 'Modern Light', dark: false,
    background: '#FFFFFF', surface: '#F5F6F8', surfaceAlt: '#ECEEF2',
    primary: '#111318', accent: '#EE7E3A', text: '#17202A', mutedText: '#6B7280',
    border: '#E2E5EA', onAccent: '#FFFFFF',
  }),
  'corporate-blue': theme({
    id: 'corporate-blue', name: 'Corporate Blue', dark: true,
    background: '#0C1B33', surface: '#13294B', surfaceAlt: '#1B3A66',
    primary: '#2563EB', accent: '#38BDF8', text: '#EAF2FF', mutedText: '#9DB4D4',
    border: '#1F4173', onAccent: '#04122B',
  }),
  'startup-orange': theme({
    id: 'startup-orange', name: 'Startup Orange', dark: true,
    background: '#12100E', surface: '#1E1A16', surfaceAlt: '#2A231C',
    primary: '#F97316', accent: '#FBBF24', text: '#FFF7ED', mutedText: '#C4B7A8',
    border: '#3A2E22', onAccent: '#1A1207',
  }),
  'technical-minimal': theme({
    id: 'technical-minimal', name: 'Technical Minimal', dark: true,
    background: '#0D1117', surface: '#161B22', surfaceAlt: '#21262D',
    primary: '#2F81F7', accent: '#3FB950', text: '#E6EDF3', mutedText: '#8B949E',
    border: '#30363D', onAccent: '#03101F',
  }),
  'elegant-white': theme({
    id: 'elegant-white', name: 'Elegant White', dark: false,
    background: '#FAFAF8', surface: '#FFFFFF', surfaceAlt: '#F0EFEA',
    primary: '#1A1A1A', accent: '#B45309', text: '#1A1A1A', mutedText: '#737373',
    border: '#E5E3DC', onAccent: '#FFFFFF',
  }),
};

export function getPresentationTheme(id: PresentationThemeId): PresentationTheme {
  return PRESENTATION_THEMES[id] ?? PRESENTATION_THEMES['larund-dark'];
}

/** Choose a default theme from the brief's tone + goal. */
export function defaultThemeFor(tone: DeckTone, goal: DeckGoal): PresentationThemeId {
  if (tone === 'technical') return 'technical-minimal';
  if (tone === 'educational') return 'modern-light';
  if (tone === 'elegant' || tone === 'minimal') return 'elegant-white';
  if (tone === 'startup' || goal === 'pitch') return 'startup-orange';
  if (tone === 'corporate' || goal === 'report') return 'corporate-blue';
  return 'larund-dark';
}

export function presentationThemeToBrand(theme: PresentationTheme): BrandTheme {
  return {
    primary: theme.primary,
    accent: theme.accent,
    background: theme.background,
    surface: theme.surface,
    text: theme.text,
    mutedText: theme.mutedText,
    fontFamily: theme.fontBody,
  };
}
