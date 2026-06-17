import type { ToolRisk } from '../tools/types';

export type McpTransport = 'stdio' | 'streamable_http' | 'cli_adapter';
export type McpTrustLevel = 'untrusted' | 'trusted' | 'verified';
export type McpServerStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'auth_required'
  | 'error'
  | 'disabled';
export type McpAuthType = 'none' | 'oauth2' | 'bearer' | 'cli_login' | 'custom_headers';

export interface McpServerConfig {
  id: string;
  /** Links this server to a Connections catalog provider (e.g. "higgsfield"). */
  providerId?: string;
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  authType?: McpAuthType;
  enabled: boolean;
  trustLevel: McpTrustLevel;
  status: McpServerStatus;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  /** Last connection error (sanitized, never a secret). */
  lastError?: string;
  metadata?: Record<string, unknown>;
}

export interface McpSecurityFlag {
  kind:
    | 'mentions_secrets'
    | 'mentions_credentials'
    | 'network_access'
    | 'filesystem_access'
    | 'process_exec'
    | 'destructive'
    | 'external_send'
    | 'prompt_injection_like'
    | 'tool_shadowing_risk'
    | 'ambiguous_description'
    | 'schema_too_permissive'
    | 'metadata_changed';
  severity: 'info' | 'warn' | 'critical';
  message: string;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface McpToolSnapshot {
  id: string;
  serverId: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  risk: ToolRisk;
  enabled: boolean;
  approved: boolean;
  metadataHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  changedAt?: string;
  flags: McpSecurityFlag[];
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: unknown;
}

export interface McpClient {
  connect(config: McpServerConfig): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<McpToolDefinition[]>;
  listResources(serverId: string): Promise<McpResource[]>;
  listPrompts(serverId: string): Promise<McpPrompt[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string; details?: Record<string, unknown>; error?: string }>;
  readResource(serverId: string, resourceUri: string): Promise<{ success: boolean; output: string; error?: string }>;
  getPrompt(serverId: string, promptName: string, args?: Record<string, unknown>): Promise<{ success: boolean; output: string; error?: string }>;
  healthCheck(serverId: string): Promise<{ ok: boolean; message: string }>;
}

export interface CreateMcpServerInput {
  providerId?: string;
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  authType?: McpAuthType;
  trustLevel?: McpTrustLevel;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}
