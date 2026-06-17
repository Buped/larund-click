// Reconciles the static catalog with live runtime state. The catalog says what an
// integration IS and how mature it is; the registry says whether the user has
// actually configured credentials. The UI needs both, so we expose a resolved
// view with a runtime connection state per provider.

import { CATALOG } from './providers';
import type { CatalogProvider } from './types';
import { providerRuntimeState } from '../registry';
import { DEFAULT_CONTEXT, type ConnectionContext } from '../connectedAccounts';

/**
 * Live per-user connection state. Distinguishes "developer hasn't configured the
 * app" from "user hasn't connected yet" from "connected".
 */
export type RuntimeConnectionState =
  | 'connected'
  | 'ready_to_connect'
  | 'api_key_required'
  | 'developer_setup_missing'
  | 'needs_reconnect'
  | 'dev_shortcut_active'
  | 'mcp_available'
  | 'coming_soon';

export interface ResolvedCatalogProvider extends CatalogProvider {
  /** Live connection state, derived from app creds + connected accounts + impl status. */
  runtime: RuntimeConnectionState;
}

function runtimeState(provider: CatalogProvider, ctx: ConnectionContext): RuntimeConnectionState {
  if (provider.status === 'mcp_available') return 'mcp_available';
  // Google sub-apps inherit Google Workspace; others use their own id.
  const baseId = provider.parentProviderId ?? provider.id;
  const state = providerRuntimeState(baseId, ctx);
  if (state === 'scaffold') return 'coming_soon';
  // Roadmap-only providers stay "coming soon" until their tools exist — but if a
  // user genuinely connected one, reflect that honestly.
  if (provider.status === 'coming_soon' && (state === 'ready_to_connect' || state === 'developer_setup_missing')) {
    return 'coming_soon';
  }
  return state;
}

export function listCatalogProviders(ctx: ConnectionContext = DEFAULT_CONTEXT): ResolvedCatalogProvider[] {
  return CATALOG.map((p) => ({ ...p, runtime: runtimeState(p, ctx) }));
}

export function getResolvedProvider(id: string, ctx: ConnectionContext = DEFAULT_CONTEXT): ResolvedCatalogProvider | undefined {
  return listCatalogProviders(ctx).find((p) => p.id === id);
}

/** Providers a user can act on now (connect or use): excludes pure coming-soon. */
export function isActionable(p: ResolvedCatalogProvider): boolean {
  return p.runtime !== 'coming_soon';
}
