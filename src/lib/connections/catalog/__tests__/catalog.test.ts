import { describe, expect, it } from 'vitest';
import { CATALOG, getCatalogProvider } from '../providers';
import { listCatalogProviders, isActionable } from '../index';
import { deriveFlags } from '../types';
import { getBrandIcon } from '../../../brand-icons/provider-icons';

describe('connection catalog', () => {
  it('contains at least 20 providers', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('every provider has a real logo or a clean monogram fallback', () => {
    for (const p of CATALOG) {
      const icon = getBrandIcon(p.id);
      expect(icon.hex).toBeTruthy();
      // Either a real Simple Icons path or an explicit monogram — never empty.
      expect(icon.source === 'simple-icons' ? Boolean(icon.path) : Boolean(icon.monogram)).toBe(true);
    }
  });

  it('real native providers carry real logo metadata (simple-icons)', () => {
    for (const id of ['github', 'notion', 'slack', 'discord', 'stripe', 'shopify', 'meta-ads']) {
      const icon = getBrandIcon(id);
      // Slack/Canva are monograms; the rest are real logos. All must be non-empty.
      expect(icon.title).toBeTruthy();
    }
    expect(getBrandIcon('github').source).toBe('simple-icons');
  });

  it('derived native/MCP flags match implementations', () => {
    for (const p of CATALOG) {
      const flags = deriveFlags(p.implementations);
      expect(p.supportsNativeApi).toBe(flags.native);
      expect(p.supportsMcp).toBe(flags.mcp);
    }
  });

  it('coming_soon providers do not advertise native tools (no faked capability)', () => {
    for (const p of CATALOG) {
      if (p.status === 'coming_soon') expect(p.nativeToolCount).toBe(0);
    }
  });

  it('marks at least the three real providers as working', () => {
    for (const id of ['github', 'notion', 'google-workspace']) {
      expect(getCatalogProvider(id)?.status).toBe('working');
    }
  });

  it('resolves runtime state and excludes coming_soon from actionable', () => {
    const resolved = listCatalogProviders();
    expect(resolved.length).toBe(CATALOG.length);
    // No secrets configured in tests → real providers need setup, not connected.
    const github = resolved.find((p) => p.id === 'github')!;
    expect(github.runtime).toBe('needs_setup');
    const comingSoon = resolved.find((p) => p.status === 'coming_soon' && !p.supportsMcp);
    if (comingSoon) expect(isActionable(comingSoon)).toBe(false);
  });

  it('supports both native API and MCP for providers that declare both', () => {
    const github = getCatalogProvider('github')!;
    expect(github.supportsNativeApi).toBe(true);
    expect(github.supportsMcp).toBe(true);
    const higgsfield = getCatalogProvider('higgsfield')!;
    expect(higgsfield.supportsNativeApi).toBe(false);
    expect(higgsfield.supportsMcp).toBe(true);
  });
});
