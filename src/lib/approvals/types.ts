import type { ToolRisk } from '../tools/types';

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved_once'
  | 'approved_always'
  | 'denied'
  | 'expired';

export interface ApprovalRequestRecord {
  id: string;
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  automationRunId?: string;
  actionName: string;
  risk: ToolRisk | string;
  reason: string;
  argsSummary: string;
  status: ApprovalRequestStatus;
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateApprovalRequestInput {
  userId: string;
  workspaceId?: string;
  taskRunId?: string;
  automationRunId?: string;
  actionName: string;
  risk: ToolRisk | string;
  reason: string;
  argsSummary: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
