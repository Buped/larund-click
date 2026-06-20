// Renders a provider's brand logo on a subtle tile that fits the dark UI (rather
// than a hard white sticker). Marks keep their brand colour; near-black marks
// (GitHub/Notion/Vercel/X) are lightened so they stay crisp on the dark tile.
// Falls back to a brand-coloured monogram when no real logo exists.

import { getBrandIcon } from '../lib/brand-icons/provider-icons';

/** Relative luminance (0–1) of a hex colour, for contrast decisions. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function BrandIcon({ providerId, size = 38, radius = 10 }: { providerId: string; size?: number; radius?: number }) {
  const icon = getBrandIcon(providerId);
  const glyph = Math.round(size * 0.56);

  if (icon.source === 'simple-icons' && icon.path) {
    // Keep the brand colour, but nudge near-black/near-white marks so they read
    // on the tile in either theme (lighten on dark, darken on light).
    const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
    const fill = luminance(icon.hex) < 0.16 ? (isLight ? '#1B1A17' : '#e9e9ec') : `#${icon.hex}`;
    return (
      <span
        title={icon.title}
        style={{ width: size, height: size, borderRadius: radius, background: 'rgba(var(--ov-color),0.06)', border: '1px solid var(--border-md, rgba(var(--ov-color),0.10))', display: 'grid', placeItems: 'center', flex: 'none' }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill={fill} aria-hidden="true" role="img">
          <path d={icon.path} />
        </svg>
      </span>
    );
  }

  // Monogram fallback on a brand-tinted tile.
  return (
    <span
      title={icon.title}
      style={{
        width: size, height: size, borderRadius: radius, flex: 'none',
        background: `#${icon.hex}`, color: '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: Math.round(size * 0.42), fontWeight: 700, letterSpacing: '-.02em',
      }}
    >
      {icon.monogram}
    </span>
  );
}
