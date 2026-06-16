// Provider brand-icon registry. Real logos come from the `simple-icons` package
// (bundled locally — no hotlinking, no invented logos). Providers whose marks are
// not in Simple Icons (Slack, Canva, Microsoft 365 were removed there for
// trademark reasons) fall back to a clean brand-coloured monogram, never a fake
// logo. Unknown/custom providers use a neutral monogram.

import {
  siGithub, siNotion, siGoogledrive, siGooglesheets, siGoogledocs, siGmail,
  siGooglecalendar, siGoogle, siFigma, siAirtable, siHubspot, siWordpress,
  siSupabase, siVercel, siLinear,
} from 'simple-icons';

export interface BrandIconData {
  title: string;
  /** SVG path from Simple Icons, when a real logo is available. */
  path?: string;
  /** Brand hex (no leading '#'). */
  hex: string;
  source: 'simple-icons' | 'monogram';
  /** Letter(s) used for the monogram fallback. */
  monogram?: string;
}

function si(icon: { title: string; path: string; hex: string }): BrandIconData {
  return { title: icon.title, path: icon.path, hex: icon.hex, source: 'simple-icons' };
}
function mono(title: string, hex: string, monogram?: string): BrandIconData {
  return { title, hex, source: 'monogram', monogram: monogram ?? title.slice(0, 1).toUpperCase() };
}

// Keyed by the same provider ids used in the connection registry + directory.
export const PROVIDER_ICONS: Record<string, BrandIconData> = {
  github: si(siGithub),
  notion: si(siNotion),
  'google-workspace': si(siGoogle),
  google: si(siGoogle),
  'google-drive': si(siGoogledrive),
  googledrive: si(siGoogledrive),
  'google-sheets': si(siGooglesheets),
  'google-docs': si(siGoogledocs),
  gmail: si(siGmail),
  'google-calendar': si(siGooglecalendar),
  figma: si(siFigma),
  airtable: si(siAirtable),
  hubspot: si(siHubspot),
  wordpress: si(siWordpress),
  supabase: si(siSupabase),
  vercel: si(siVercel),
  linear: si(siLinear),
  // Not in Simple Icons → brand-coloured monogram fallbacks.
  slack: mono('Slack', '611f69', 'S'),
  canva: mono('Canva', '00C4CC', 'C'),
  'microsoft-365': mono('Microsoft 365', 'D83B01', 'M'),
};

export function getBrandIcon(providerId: string): BrandIconData {
  return PROVIDER_ICONS[providerId] ?? mono(providerId || 'Custom', '6B7280', (providerId || 'C').slice(0, 1).toUpperCase());
}
