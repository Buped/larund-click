// Renders a provider's brand logo on a light rounded tile (the same pattern real
// connector directories use, so dark-on-dark logos like Notion/Vercel stay
// crisp). Falls back to a brand-coloured monogram when no real logo exists.

import { getBrandIcon } from '../lib/brand-icons/provider-icons';

export function BrandIcon({ providerId, size = 38, radius = 10 }: { providerId: string; size?: number; radius?: number }) {
  const icon = getBrandIcon(providerId);
  const glyph = Math.round(size * 0.56);

  if (icon.source === 'simple-icons' && icon.path) {
    // Very dark marks (e.g. #000) render in near-black on a light tile.
    const fill = `#${icon.hex}`;
    return (
      <span
        title={icon.title}
        style={{ width: size, height: size, borderRadius: radius, background: '#f4f4f5', border: '1px solid rgba(0,0,0,0.06)', display: 'grid', placeItems: 'center', flex: 'none' }}
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
