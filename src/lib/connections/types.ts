import type { ToolRisk } from '../control-system/types';
import type { ConnectionCallResult } from '../tools/types';

export type { ConnectionCallResult } from '../tools/types';
export type { ToolRisk } from '../control-system/types';

export type AuthType = 'api_key' | 'oauth' | 'none' | 'custom';

export interface ConnectionAuth {
  type: AuthType;
  /** Env/secret-store keys this connection reads (never logged). */
  envVars?: string[];
  scopes?: string[];
}

export interface ConnectionToolDefinition {
  /** Fully-qualified tool name, e.g. "github.read_file". */
  name: string;
  description: string;
  risk: ToolRisk;
  run(args: Record<string, unknown>, secrets: Record<string, string>): Promise<ConnectionCallResult>;
}

export interface ConnectionManifest {
  id: string;
  name: string;
  description: string;
  auth: ConnectionAuth;
  tools: ConnectionToolDefinition[];
  skills?: string[];
  /** When true the provider is scaffolded but not yet runnable. */
  scaffold?: boolean;
  risk?: ToolRisk;
}

export type ConnectionStatus = 'configured' | 'missing_auth' | 'scaffold' | 'disabled';

export interface ConnectionInfo {
  id: string;
  name: string;
  description: string;
  status: ConnectionStatus;
  authType: AuthType;
  scopes: string[];
  tools: string[];
}
