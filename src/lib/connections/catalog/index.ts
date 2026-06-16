// Reconciles the static catalog with live runtime state. The catalog says what an
// integration IS and how mature it is; the registry says whether the user has
// actually configured credentials. The UI needs both, so we expose a resolved
// view with a runtime connection state per provider.

import { CATALOG } from './providers';
import type { CatalogProvider } from './types';
import { ALL_MANIFESTS, connectionStatus } from '../registry';

export type RuntimeConnectionState = 'connected' | 'needs_setup' | 'available' | 'coming_soon';

export interface ResolvedCatalogProvider extends CatalogProvider {
  /** Live connection state, derived from credentials + implementation status. */
  runtime: RuntimeConnectionState;
}

function runtimeState(provider: CatalogProvider): RuntimeConnectionState {
  // Real registry providers reflect actual secret presence.
  const manifest = ALL_MANIFESTS.find((m) => m.id === provider.id);
  if (manifest) {
    const s = connectionStatus(manifest);
    if (s === 'configured') return 'connected';
    if (s === 'missing_auth') return 'needs_setup';
  }
  // Google sub-apps inherit the Google Workspace credential state.
  if (['google-drive', 'google-docs', 'google-sheets', 'gmail', 'google-calendar'].includes(provider.id)) {
    const gw = ALL_MANIFESTS.find((m) => m.id === 'google-workspace');
    if (gw && connectionStatus(gw) === 'configured') return 'connected';
    if (provider.status === 'working' || provider.status === 'partial') return 'needs_setup';
  }
  if (provider.status === 'working' || provider.status === 'partial' || provider.status === 'needs_setup') return 'needs_setup';
  if (provider.status === 'mcp_available') return 'available';
  return 'coming_soon';
}

export function listCatalogProviders(): ResolvedCatalogProvider[] {
  return CATALOG.map((p) => ({ ...p, runtime: runtimeState(p) }));
}

export function getResolvedProvider(id: string): ResolvedCatalogProvider | undefined {
  return listCatalogProviders().find((p) => p.id === id);
}

/** Providers a user can act on now (connect or use): excludes pure coming-soon. */
export function isActionable(p: ResolvedCatalogProvider): boolean {
  return p.runtime !== 'coming_soon';
}
