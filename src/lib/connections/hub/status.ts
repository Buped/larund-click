// Pure mapping from the existing ConnectionManifest list into product-grade
// ConnectionProvider records, plus a non-destructive "test connection" planner.

import type { ConnectionManifest } from '../types';
import { ALL_MANIFESTS, connectionStatus } from '../registry';
import type {
  ConnectionProvider,
  ProviderAuthType,
  ProviderCategory,
  ProviderStatus,
} from './types';

function inferCategory(m: ConnectionManifest): ProviderCategory {
  const id = m.id.toLowerCase();
  if (/(github|gitlab|vercel|supabase)/.test(id)) return 'development';
  if (/(slack|gmail|mail|discord|teams)/.test(id)) return 'communication';
  if (/(hubspot|wordpress|marketing|mailchimp)/.test(id)) return 'marketing';
  if (/(airtable|sheets|data|bigquery)/.test(id)) return 'data';
  if (/(google|notion|drive|docs|calendar|office)/.test(id)) return 'productivity';
  return 'custom';
}

function mapAuthType(m: ConnectionManifest): ProviderAuthType {
  switch (m.auth.type) {
    case 'oauth':
      // Google Workspace currently uses an access token under the hood.
      return m.auth.envVars?.some((v) => /ACCESS_TOKEN/i.test(v)) ? 'access_token' : 'oauth';
    case 'api_key':
      return 'api_key';
    case 'none':
      return 'none';
    case 'custom':
    default:
      return 'local';
  }
}

function mapStatus(m: ConnectionManifest): ProviderStatus {
  const s = connectionStatus(m);
  switch (s) {
    case 'configured':
      return 'configured';
    case 'missing_auth':
      return 'missing_auth';
    case 'scaffold':
      return 'available';
    case 'disabled':
    default:
      return 'available';
  }
}

export function providerFromManifest(m: ConnectionManifest): ConnectionProvider {
  return {
    id: m.id,
    name: m.name,
    category: inferCategory(m),
    description: m.description,
    authType: mapAuthType(m),
    tools: m.tools.map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
    status: mapStatus(m),
    scaffold: Boolean(m.scaffold),
    envVars: m.auth.envVars ?? [],
    scopes: m.auth.scopes ?? [],
  };
}

/** All providers known to the hub. */
export function listProviders(): ConnectionProvider[] {
  return ALL_MANIFESTS.map(providerFromManifest);
}

export function getProvider(id: string): ConnectionProvider | undefined {
  const m = ALL_MANIFESTS.find((x) => x.id === id);
  return m ? providerFromManifest(m) : undefined;
}

export interface ConnectionTestPlan {
  providerId: string;
  /** Whether the connection is runnable at all right now. */
  runnable: boolean;
  /** A read-only tool + args to probe the connection without writing anything. */
  probe?: { tool: string; args: Record<string, unknown> };
  /** User-facing message when not runnable (e.g. missing auth). */
  message?: string;
}

/**
 * Plan a NON-DESTRUCTIVE connectivity test. We never create files during a test;
 * we pick a read-only/metadata tool when one exists, otherwise report that a safe
 * probe is unavailable. The caller executes the probe via the registry.
 */
export function planConnectionTest(provider: ConnectionProvider): ConnectionTestPlan {
  if (provider.scaffold) {
    return { providerId: provider.id, runnable: false, message: 'Provider is a scaffold and not yet runnable.' };
  }
  if (provider.status === 'missing_auth') {
    return {
      providerId: provider.id,
      runnable: false,
      message: `Missing auth. Configure ${provider.envVars.join(', ') || 'credentials'} to enable ${provider.name}.`,
    };
  }
  const readOnly = provider.tools.find((t) => t.risk === 'read_only' || t.risk === 'external_read');
  if (!readOnly) {
    return { providerId: provider.id, runnable: true, message: 'No read-only probe available; skip automated test.' };
  }
  return { providerId: provider.id, runnable: true, probe: { tool: readOnly.name, args: {} } };
}
