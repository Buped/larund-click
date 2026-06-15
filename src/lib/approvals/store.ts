import { recordBackend, type RecordRow } from '../coworker/persistence';
import { createNotification } from '../notifications/store';
import type { ApprovalRequestRecord, ApprovalRequestStatus, CreateApprovalRequestInput } from './types';

const TABLE = 'approval_requests';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApproval(row: RecordRow): ApprovalRequestRecord {
  return row as unknown as ApprovalRequestRecord;
}

export async function createApprovalRequest(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord> {
  const now = new Date();
  const request: ApprovalRequestRecord = {
    id: id('approval'),
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: input.expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
    ...input,
  };
  await recordBackend().put(TABLE, request as unknown as RecordRow);
  await createNotification({
    userId: request.userId,
    workspaceId: request.workspaceId,
    kind: 'approval_needed',
    title: `Approval needed: ${request.actionName}`,
    body: `${request.risk}: ${request.reason}`,
    actionUrl: `approval:${request.id}`,
    metadata: { approvalId: request.id, taskRunId: request.taskRunId, automationRunId: request.automationRunId },
  });
  return request;
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequestRecord | null> {
  const row = await recordBackend().get(TABLE, id);
  return row ? toApproval(row) : null;
}

export async function listApprovalRequests(filter: {
  userId: string;
  workspaceId?: string;
  status?: ApprovalRequestStatus;
}): Promise<ApprovalRequestRecord[]> {
  const rows = await recordBackend().all(TABLE);
  const now = Date.now();
  const requests = rows
    .map(toApproval)
    .map((r) => (r.status === 'pending' && new Date(r.expiresAt).getTime() < now ? { ...r, status: 'expired' as const } : r))
    .filter((r) => r.userId === filter.userId)
    .filter((r) => !filter.workspaceId || r.workspaceId === filter.workspaceId)
    .filter((r) => !filter.status || r.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  await Promise.all(
    requests
      .filter((r) => r.status === 'expired')
      .map((r) => recordBackend().put(TABLE, r as unknown as RecordRow)),
  );
  return requests;
}

export async function resolveApprovalRequest(
  id: string,
  status: Extract<ApprovalRequestStatus, 'approved_once' | 'approved_always' | 'denied'>,
): Promise<ApprovalRequestRecord | null> {
  const request = await getApprovalRequest(id);
  if (!request) return null;
  const updated: ApprovalRequestRecord = {
    ...request,
    status,
    resolvedAt: new Date().toISOString(),
  };
  await recordBackend().put(TABLE, updated as unknown as RecordRow);
  return updated;
}
