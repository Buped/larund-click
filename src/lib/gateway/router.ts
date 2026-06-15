import { resolveApprovalRequest } from '../approvals/store';
import { enqueueTask, getQueueItem } from '../queue/store';
import { listTaskRuns } from '../tasks/store';
import { listWorkspaces } from '../workspaces/store';
import { parseGatewayCommand, renderGatewayHelp } from './commands';
import { getGatewayChannel, saveGatewayMessage, updateGatewayChannel } from './store';
import type { GatewayInboundInput } from './types';

export async function routeGatewayMessage(input: GatewayInboundInput): Promise<string> {
  const channel = await getGatewayChannel(input.channelId);
  if (!channel) return 'Channel not found.';
  if (!channel.enabled) return 'Channel is disabled.';
  if (channel.trustedSenderIds?.length && !channel.trustedSenderIds.includes(input.sender)) {
    await saveGatewayMessage({
      channelId: channel.id,
      userId: channel.userId,
      workspaceId: channel.workspaceId,
      externalMessageId: input.externalMessageId,
      direction: 'inbound',
      sender: input.sender,
      text: input.text,
      attachments: input.attachments,
      metadata: { rejected: true, reason: 'unknown_sender', ...input.metadata },
    });
    return 'Sender is not linked to this Larund workspace.';
  }

  const workspaceId = channel.defaultWorkspaceId ?? channel.workspaceId;
  await saveGatewayMessage({
    channelId: channel.id,
    userId: channel.userId,
    workspaceId,
    externalMessageId: input.externalMessageId,
    direction: 'inbound',
    sender: input.sender,
    text: input.text,
    attachments: input.attachments,
    metadata: input.metadata,
  });

  const command = parseGatewayCommand(input.text);
  if (command.kind !== 'unknown' && !channel.allowedCommands.includes(command.kind)) {
    return `Command /${command.kind} is not allowed for this channel.`;
  }

  switch (command.kind) {
    case 'task': {
      const item = await enqueueTask({
        userId: channel.userId,
        workspaceId,
        source: 'gateway',
        prompt: command.prompt,
        priority: 'normal',
        metadata: { gatewayChannelId: channel.id, sender: input.sender, attachments: input.attachments },
      });
      const text = `Task queued: ${item.id}`;
      await saveGatewayMessage({ channelId: channel.id, userId: channel.userId, workspaceId, direction: 'outbound', sender: 'larund', text });
      return text;
    }
    case 'status': {
      const queueItem = await getQueueItem(command.taskId);
      if (queueItem) return `${queueItem.id}: ${queueItem.status}${queueItem.progress ? ` - ${queueItem.progress}` : ''}`;
      const tasks = await listTaskRuns({ userId: channel.userId });
      const task = tasks.find((t) => t.id === command.taskId);
      return task ? `${task.id}: ${task.status}${task.summary ? ` - ${task.summary}` : ''}` : `No task found for ${command.taskId}.`;
    }
    case 'approve': {
      const resolved = await resolveApprovalRequest(command.approvalId, command.always ? 'approved_always' : 'approved_once');
      return resolved ? `Approved ${resolved.actionName}.` : 'Approval request not found.';
    }
    case 'deny': {
      const resolved = await resolveApprovalRequest(command.approvalId, 'denied');
      return resolved ? `Denied ${resolved.actionName}.` : 'Approval request not found.';
    }
    case 'workspaces': {
      const workspaces = await listWorkspaces(channel.userId);
      return workspaces.length ? workspaces.map((w) => `${w.id}: ${w.name}`).join('\n') : 'No workspaces found.';
    }
    case 'use_workspace': {
      const workspaces = await listWorkspaces(channel.userId);
      const match = workspaces.find((w) => w.id === command.workspace || w.name.toLowerCase() === command.workspace.toLowerCase());
      if (!match) return `Workspace not found: ${command.workspace}`;
      await updateGatewayChannel(channel.id, { defaultWorkspaceId: match.id });
      return `Using workspace: ${match.name}`;
    }
    case 'help':
      return renderGatewayHelp();
    case 'unknown':
      return command.reason;
    default:
      return renderGatewayHelp();
  }
}
