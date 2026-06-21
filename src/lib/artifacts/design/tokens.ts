// Central design tokens for generated document artifacts.
//
// Tokens describe the *visual language* (color, type scale, spacing, radius,
// shadow) that templates and the Rust renderer share, so every generated
// document is designed by default rather than rendered as plain text.

export interface ArtifactDesignTokens {
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    primary: string;
    accent: string;
    text: string;
    textMuted: string;
    border: string;
    onPrimary: string;
    success: string;
    warning: string;
    danger: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont: string;
    h1: string;
    h2: string;
    h3: string;
    body: string;
    small: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
  };
  shadows: {
    card: string;
    soft: string;
  };
}

/** Accent-safe font stacks. The Rust renderer embeds the matching system font
 *  (Segoe UI / Arial / DejaVu / Noto) so Hungarian accents always render. */
export const FONT_STACKS = {
  heading: '"Inter", "Segoe UI", "Noto Sans", "DejaVu Sans", Arial, sans-serif',
  body: '"Inter", "Segoe UI", "Noto Sans", "DejaVu Sans", Arial, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Code", "Consolas", monospace',
} as const;

export const BASE_SPACING: ArtifactDesignTokens['spacing'] = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '40px',
  xxl: '64px',
};

export const BASE_RADIUS: ArtifactDesignTokens['radius'] = {
  sm: '6px',
  md: '10px',
  lg: '18px',
};

export const BASE_TYPE_SCALE = {
  h1: '34px',
  h2: '22px',
  h3: '16px',
  body: '13px',
  small: '10px',
} as const;

export const BASE_SHADOWS: ArtifactDesignTokens['shadows'] = {
  card: '0 12px 32px rgba(15, 23, 42, 0.12)',
  soft: '0 2px 8px rgba(15, 23, 42, 0.08)',
};
