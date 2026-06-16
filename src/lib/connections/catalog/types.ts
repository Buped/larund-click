// Connection catalog (V2). A product-facing directory of integrations that is
// independent of, but reconciled with, the runtime connection registry. A
// catalog entry describes WHAT an integration is and HOW it can be connected
// (native API and/or MCP-backed), plus an honest implementation status so the UI
// never fakes capability. Runtime execution still flows through the existing
// ConnectionRegistry / MCP client — this layer is metadata + roadmap.

export type CatalogCategory =
  | 'productivity'
  | 'development'
  | 'marketing'
  | 'communication'
  | 'data'
  | 'commerce'
  | 'finance'
  | 'analytics'
  | 'creative';

/**
 * Honest implementation status:
 * - working:     native tools implemented and runnable today
 * - partial:     some tools implemented; others stubbed/setup-required
 * - mcp_available: usable via an MCP server (no native tools yet)
 * - needs_setup: implemented but requires the user to add credentials
 * - coming_soon: manifest/roadmap only; not runnable
 */
export type CatalogStatus = 'working' | 'partial' | 'mcp_available' | 'needs_setup' | 'coming_soon';

export type ConnectionAuthType = 'oauth2' | 'api_key' | 'personal_access_token' | 'access_token' | 'none';

export type ConnectionImplementation =
  | { kind: 'native_api'; authType: ConnectionAuthType; providerModule: string }
  | { kind: 'remote_mcp'; defaultServerUrl?: string; userEditableUrl: boolean; oauthClientId?: string; oauthClientSecretRef?: string }
  | { kind: 'local_mcp'; commandTemplate?: string; args?: string[] }
  | { kind: 'manual_setup'; instructions: string };

export interface CatalogProvider {
  id: string;
  name: string;
  description: string;
  category: CatalogCategory;
  /** All ways this provider can be connected (native, MCP, manual). */
  implementations: ConnectionImplementation[];
  status: CatalogStatus;
  /** Convenience flags derived from `implementations` (precomputed for the UI). */
  supportsNativeApi: boolean;
  supportsMcp: boolean;
  /** Whether the user may paste a custom MCP server URL for this provider. */
  userEditableMcpUrl: boolean;
  /** Number of native tools when implemented (0 for MCP-only / coming soon). */
  nativeToolCount: number;
  setupInstructions?: string;
  docsUrl?: string;
}

export function deriveFlags(impls: ConnectionImplementation[]): { native: boolean; mcp: boolean; editableUrl: boolean } {
  let native = false, mcp = false, editableUrl = false;
  for (const i of impls) {
    if (i.kind === 'native_api') native = true;
    if (i.kind === 'remote_mcp' || i.kind === 'local_mcp') mcp = true;
    if (i.kind === 'remote_mcp' && i.userEditableUrl) editableUrl = true;
  }
  return { native, mcp, editableUrl };
}
