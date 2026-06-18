import { describe, expect, it } from 'vitest';
import { CATALOG, getCatalogProvider } from '../providers';
import { listCatalogProviders, isActionable } from '../index';
import { deriveFlags } from '../types';
import { getBrandIcon } from '../../../brand-icons/provider-icons';

describe('connection catalog', () => {
  it('contains at least 35 providers', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(35);
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

  it('marks real native providers as working', () => {
    for (const id of ['github', 'notion', 'google-workspace', 'x']) {
      expect(getCatalogProvider(id)?.status).toBe('working');
    }
  });

  it('exposes a single unified Google connection (no per-app sub-cards)', () => {
    expect(getCatalogProvider('google-workspace')?.name).toBe('Google');
    for (const id of ['google-drive', 'google-docs', 'google-sheets', 'gmail', 'google-calendar']) {
      expect(getCatalogProvider(id)).toBeUndefined();
    }
  });

  it('every provider has official developer docs', () => {
    for (const p of CATALOG) {
      expect(p.docsUrl).toBeTruthy();
    }
  });

  it('every provider exposes env setup groups', () => {
    for (const p of CATALOG) {
      expect(Array.isArray(p.env.required)).toBe(true);
      expect(Array.isArray(p.env.optional)).toBe(true);
      expect(Array.isArray(p.env.advanced)).toBe(true);
    }
    // env.required now means APP-LEVEL developer credentials, never user tokens.
    expect(getCatalogProvider('x')?.env.required).toEqual(['X_CLIENT_ID']);
    expect(getCatalogProvider('x')?.env.required).not.toContain('X_BEARER_TOKEN');
  });

  it('resolves runtime state and excludes coming_soon from actionable', () => {
    const resolved = listCatalogProviders();
    expect(resolved.length).toBe(CATALOG.length);
    // No app credentials configured in tests → GitHub needs developer setup, not connected.
    const github = resolved.find((p) => p.id === 'github')!;
    expect(github.runtime).toBe('developer_setup_missing');
    // API-key providers surface "Add API key", not "developer setup".
    expect(resolved.find((p) => p.id === 'resend')!.runtime).toBe('api_key_required');
    // An OAuth-only coming_soon provider with no app creds is not actionable.
    const metaAds = resolved.find((p) => p.id === 'meta-ads')!;
    expect(metaAds.runtime).toBe('coming_soon');
    expect(isActionable(metaAds)).toBe(false);
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
