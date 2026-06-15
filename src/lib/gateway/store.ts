import { recordBackend, type RecordRow } from '../coworker/persistence';
import type { GatewayChannel, GatewayKind, GatewayMessage } from './types';

const CHANNELS = 'gateway_channels';
const MESSAGES = 'gateway_messages';

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toChannel(row: RecordRow): GatewayChannel {
  return row as unknown as GatewayChannel;
}

function toMessage(row: RecordRow): GatewayMessage {
  return row as unknown as GatewayMessage;
}

export async function createGatewayChannel(input: {
  userId: string;
  workspaceId?: string;
  kind?: GatewayKind;
  displayName: string;
  enabled?: boolean;
  allowedCommands?: string[];
  defaultWorkspaceId?: string;
  trustedSenderIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<GatewayChannel> {
  const now = new Date().toISOString();
  const channel: GatewayChannel = {
    id: id('gateway'),
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: input.kind ?? 'local',
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    authStatus: input.kind && input.kind !== 'local' ? 'not_configured' : 'linked',
    allowedCommands: input.allowedCommands ?? ['task', 'status', 'approve', 'deny', 'workspaces', 'use_workspace', 'help'],
    defaultWorkspaceId: input.defaultWorkspaceId,
    trustedSenderIds: input.trustedSenderIds,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
  await recordBackend().put(CHANNELS, channel as unknown as RecordRow);
  return channel;
}

export async function getGatewayChannel(id: string): Promise<GatewayChannel | null> {
  const row = await recordBackend().get(CHANNELS, id);
  return row ? toChannel(row) : null;
}

export async function listGatewayChannels(filter: { userId: string; kind?: GatewayKind }): Promise<GatewayChannel[]> {
  const rows = await recordBackend().all(CHANNELS);
  return rows
    .map(toChannel)
    .filter((c) => c.userId === filter.userId)
    .filter((c) => !filter.kind || c.kind === filter.kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateGatewayChannel(id: string, patch: Partial<Omit<GatewayChannel, 'id' | 'createdAt'>>): Promise<GatewayChannel | null> {
  const channel = await getGatewayChannel(id);
  if (!channel) return null;
  const updated = { ...channel, ...patch, updatedAt: new Date().toISOString() };
  await recordBackend().put(CHANNELS, updated as unknown as RecordRow);
  return updated;
}

export async function saveGatewayMessage(input: Omit<GatewayMessage, 'id' | 'createdAt'>): Promise<GatewayMessage> {
  const message: GatewayMessage = {
    id: id('gateway-msg'),
    createdAt: new Date().toISOString(),
    ...input,
  };
  await recordBackend().put(MESSAGES, message as unknown as RecordRow);
  return message;
}

export async function listGatewayMessages(channelId: string): Promise<GatewayMessage[]> {
  const rows = await recordBackend().all(MESSAGES);
  return rows
    .map(toMessage)
    .filter((m) => m.channelId === channelId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
