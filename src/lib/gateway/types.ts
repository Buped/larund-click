export type GatewayKind = 'telegram' | 'slack' | 'email' | 'webhook' | 'local';
export type GatewayAuthStatus = 'not_configured' | 'configured' | 'linked' | 'error';
export type GatewayDirection = 'inbound' | 'outbound';

export interface GatewayChannel {
  id: string;
  userId: string;
  workspaceId?: string;
  kind: GatewayKind;
  displayName: string;
  enabled: boolean;
  authStatus: GatewayAuthStatus;
  allowedCommands: string[];
  defaultWorkspaceId?: string;
  trustedSenderIds?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayMessage {
  id: string;
  channelId: string;
  userId: string;
  workspaceId?: string;
  externalMessageId?: string;
  direction: GatewayDirection;
  sender: string;
  text: string;
  attachments?: Array<{ name: string; uri: string; contentType?: string }>;
  taskRunId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type GatewayCommand =
  | { kind: 'task'; prompt: string }
  | { kind: 'status'; taskId: string }
  | { kind: 'approve'; approvalId: string; always?: boolean }
  | { kind: 'deny'; approvalId: string }
  | { kind: 'workspaces' }
  | { kind: 'use_workspace'; workspace: string }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string; reason: string };

export interface GatewayInboundInput {
  channelId: string;
  sender: string;
  text: string;
  externalMessageId?: string;
  attachments?: GatewayMessage['attachments'];
  metadata?: Record<string, unknown>;
}
