import type { ToolRisk } from '../tools/types';

export interface CustomApiConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'api_key_header';
  secretRef?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomApiTool {
  id: string;
  connectionId: string;
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pathTemplate: string;
  querySchema?: unknown;
  bodySchema?: unknown;
  headers?: Record<string, string>;
  risk: ToolRisk;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomApiConnectionInput {
  userId: string;
  workspaceId?: string;
  name: string;
  baseUrl: string;
  authType?: CustomApiConnection['authType'];
  secretRef?: string;
  enabled?: boolean;
}

export interface CreateCustomApiToolInput {
  connectionId: string;
  name: string;
  description: string;
  method: CustomApiTool['method'];
  pathTemplate: string;
  querySchema?: unknown;
  bodySchema?: unknown;
  headers?: Record<string, string>;
  risk?: ToolRisk;
  enabled?: boolean;
}
