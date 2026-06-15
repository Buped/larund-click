export type AutomationStatus = 'active' | 'paused' | 'error' | 'disabled';
export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type AutomationTrigger =
  | { kind: 'schedule'; cron?: string; intervalMinutes?: number; timezone?: string }
  | { kind: 'manual' }
  | { kind: 'webhook'; secretRef?: string }
  | { kind: 'connection_event'; providerId: string; eventType: string; filter?: Record<string, unknown> }
  | { kind: 'folder_watch'; path: string; pattern?: string };

export interface AutomationTaskTemplate {
  prompt: string;
  skillIds?: string[];
  workflowTemplateId?: string;
  roleTemplateId?: string;
  requiredConnectionIds?: string[];
  inputMapping?: Record<string, unknown>;
}

export interface AutomationApprovalPolicy {
  requireApprovalFor?: string[];
  allowAlwaysSafeActions?: boolean;
  externalSendRequiresApproval?: boolean;
  destructiveRequiresApproval?: boolean;
}

export interface Automation {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  taskTemplate: AutomationTaskTemplate;
  autonomyMode: 'manual' | 'semi' | 'full';
  approvalPolicy: AutomationApprovalPolicy;
  status: AutomationStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  taskRunId?: string;
  queueItemId?: string;
  status: AutomationRunStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  triggerPayload?: Record<string, unknown>;
}

export interface CreateAutomationInput {
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  taskTemplate: AutomationTaskTemplate;
  autonomyMode?: 'manual' | 'semi' | 'full';
  approvalPolicy?: AutomationApprovalPolicy;
  metadata?: Record<string, unknown>;
}
