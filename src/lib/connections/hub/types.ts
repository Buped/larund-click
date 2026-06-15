// Connections Hub types (Phase 1). The hub is a product-grade view layered over
// the existing connection manifests/registry. A ConnectionProvider describes what
// is *available*; a ConnectionInstance is a user's *configured* connection within
// a workspace. The underlying tool execution still flows through
// `connection.call` → ConnectionRegistry, unchanged.

import type { ToolRisk } from '../../control-system/types';

export type ProviderCategory =
  | 'productivity'
  | 'development'
  | 'marketing'
  | 'data'
  | 'communication'
  | 'custom';

export type ProviderAuthType = 'none' | 'oauth' | 'api_key' | 'access_token' | 'local' | 'mcp';

export type ProviderStatus = 'available' | 'configured' | 'missing_auth' | 'error';

export interface ConnectionToolInfo {
  name: string;
  description: string;
  risk: ToolRisk;
}

export interface ConnectionProvider {
  id: string;
  name: string;
  category: ProviderCategory;
  description: string;
  authType: ProviderAuthType;
  tools: ConnectionToolInfo[];
  status: ProviderStatus;
  /** True for placeholder providers not yet runnable (scaffolds). */
  scaffold: boolean;
  /** Env/secret keys this provider reads (never logged). */
  envVars: string[];
  scopes: string[];
}

export type InstanceStatus = 'connected' | 'missing_auth' | 'error' | 'disabled';

export interface ConnectionInstance {
  id: string;
  userId: string;
  workspaceId?: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
  scopes: string[];
  secretsRef?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  status: InstanceStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateConnectionInstanceInput {
  userId: string;
  workspaceId?: string;
  providerId: string;
  displayName?: string;
  scopes?: string[];
  secretsRef?: string;
  enabled?: boolean;
}
