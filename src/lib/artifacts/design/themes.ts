// Named document themes. Each theme resolves to a full token set and, for the
// Rust vector renderer, a flat `brand` palette (hex colors) carried on the model.

import {
  BASE_RADIUS,
  BASE_SHADOWS,
  BASE_SPACING,
  BASE_TYPE_SCALE,
  FONT_STACKS,
  type ArtifactDesignTokens,
} from './tokens';
import type { BrandTheme } from '../types';

export type ArtifactThemeId =
  | 'premiumDark'
  | 'corporateBlue'
  | 'modernLight'
  | 'invoiceBlue'
  | 'invoiceGreen'
  | 'startupPitchDark'
  | 'minimalEditorial'
  | 'technicalSpec';

export interface ArtifactTheme {
  id: ArtifactThemeId;
  label: string;
  tokens: ArtifactDesignTokens;
}

function theme(
  id: ArtifactThemeId,
  label: string,
  colors: ArtifactDesignTokens['colors'],
): ArtifactTheme {
  return {
    id,
    label,
    tokens: {
      colors,
      typography: {
        headingFont: FONT_STACKS.heading,
        bodyFont: FONT_STACKS.body,
        monoFont: FONT_STACKS.mono,
        ...BASE_TYPE_SCALE,
      },
      spacing: BASE_SPACING,
      radius: BASE_RADIUS,
      shadows: BASE_SHADOWS,
    },
  };
}

export const ARTIFACT_THEMES: Record<ArtifactThemeId, ArtifactTheme> = {
  premiumDark: theme('premiumDark', 'Premium Dark', {
    background: '#0B0E14', surface: '#171A21', surfaceAlt: '#1F242E',
    primary: '#EE7E3A', accent: '#F4A261', text: '#F7EFE3', textMuted: '#A6AEBD',
    border: '#2A2F3A', onPrimary: '#0B0E14', success: '#3FB984', warning: '#E0B341', danger: '#E5484D',
  }),
  corporateBlue: theme('corporateBlue', 'Corporate Blue', {
    background: '#F6F8FB', surface: '#FFFFFF', surfaceAlt: '#EEF2F8',
    primary: '#1E3A8A', accent: '#2563EB', text: '#0F172A', textMuted: '#64748B',
    border: '#CBD5E1', onPrimary: '#FFFFFF', success: '#16A34A', warning: '#D97706', danger: '#DC2626',
  }),
  modernLight: theme('modernLight', 'Modern Light', {
    background: '#F7F7F8', surface: '#FFFFFF', surfaceAlt: '#F1F1F3',
    primary: '#111318', accent: '#EE7E3A', text: '#17202A', textMuted: '#6B7280',
    border: '#E2E5EA', onPrimary: '#FFFFFF', success: '#16A34A', warning: '#D97706', danger: '#DC2626',
  }),
  invoiceBlue: theme('invoiceBlue', 'Invoice Blue', {
    background: '#FFFFFF', surface: '#F1F5F9', surfaceAlt: '#E2E8F0',
    primary: '#1E3A8A', accent: '#2563EB', text: '#0F172A', textMuted: '#64748B',
    border: '#CBD5E1', onPrimary: '#FFFFFF', success: '#16A34A', warning: '#D97706', danger: '#DC2626',
  }),
  invoiceGreen: theme('invoiceGreen', 'Invoice Green', {
    background: '#FFFFFF', surface: '#F0FDF4', surfaceAlt: '#DCFCE7',
    primary: '#166534', accent: '#16A34A', text: '#0F172A', textMuted: '#64748B',
    border: '#BBF7D0', onPrimary: '#FFFFFF', success: '#16A34A', warning: '#D97706', danger: '#DC2626',
  }),
  startupPitchDark: theme('startupPitchDark', 'Startup Pitch Dark', {
    background: '#0A0A0F', surface: '#15151F', surfaceAlt: '#1E1E2C',
    primary: '#7C3AED', accent: '#22D3EE', text: '#F5F5FA', textMuted: '#A1A1B5',
    border: '#2A2A3A', onPrimary: '#0A0A0F', success: '#34D399', warning: '#FBBF24', danger: '#F87171',
  }),
  minimalEditorial: theme('minimalEditorial', 'Minimal Editorial', {
    background: '#FFFFFF', surface: '#FAFAF8', surfaceAlt: '#F0EFEA',
    primary: '#1A1A1A', accent: '#B45309', text: '#1A1A1A', textMuted: '#737373',
    border: '#E5E3DC', onPrimary: '#FFFFFF', success: '#15803D', warning: '#B45309', danger: '#B91C1C',
  }),
  technicalSpec: theme('technicalSpec', 'Technical Spec', {
    background: '#0D1117', surface: '#161B22', surfaceAlt: '#21262D',
    primary: '#2F81F7', accent: '#3FB950', text: '#E6EDF3', textMuted: '#8B949E',
    border: '#30363D', onPrimary: '#FFFFFF', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  }),
};

export type DocumentKind =
  | 'invoice' | 'report' | 'proposal' | 'contract' | 'one_pager'
  | 'technical_doc' | 'letter' | 'presentation' | 'generic';

/** Default theme for a document kind — the "designed by default" mapping. */
export function defaultThemeForKind(kind: DocumentKind): ArtifactThemeId {
  switch (kind) {
    case 'invoice': return 'invoiceBlue';
    case 'presentation': return 'startupPitchDark';
    case 'technical_doc': return 'technicalSpec';
    case 'report': return 'premiumDark';
    case 'proposal': return 'corporateBlue';
    default: return 'modernLight';
  }
}

export function getTheme(id: ArtifactThemeId): ArtifactTheme {
  return ARTIFACT_THEMES[id] ?? ARTIFACT_THEMES.modernLight;
}

/** Flat brand palette the Rust renderer consumes via `model.brand`. */
export function themeToBrand(id: ArtifactThemeId, name?: string): BrandTheme {
  const t = getTheme(id).tokens.colors;
  return {
    name,
    primary: t.primary,
    accent: t.accent,
    background: t.background,
    surface: t.surface,
    text: t.text,
    mutedText: t.textMuted,
    fontFamily: getTheme(id).tokens.typography.bodyFont,
  };
}
