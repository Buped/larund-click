import type { ReferencedContext } from '../mentions/types';
export type { ReferencedContext } from '../mentions/types';

export type AutomationStatus = 'active' | 'paused' | 'error' | 'disabled';
export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type AutomationTrigger =
  | { kind: 'schedule'; cron?: string; intervalMinutes?: number; timezone?: string }
  | { kind: 'manual' }
  | { kind: 'webhook'; secretRef?: string }
  | { kind: 'connection_event'; providerId: string; eventType: string; filter?: Record<string, unknown> }
  | {
      kind: 'folder_watch';
      path: string;
      pattern?: string;
      event?: 'file_created' | 'file_modified' | 'file_created_or_modified';
      debounceMs?: number;
      stableForMs?: number;
      includeSubfolders?: boolean;
      pollIntervalMs?: number;
    };

export interface AutomationTaskTemplate {
  prompt: string;
  skillIds?: string[];
  workflowTemplateId?: string;
  roleTemplateId?: string;
  requiredConnectionIds?: string[];
  inputMapping?: Record<string, unknown>;
}

// ── Workflow-builder model (additive; old automations migrate, see migrate.ts) ──

export interface AutomationStep {
  id: string;
  title: string;
  instruction: string;
  referencedContext: ReferencedContext[];
  required: boolean;
  order: number;
  verificationHint?: string;
}

export type VerificationKind =
  | 'file_exists'
  | 'file_read_back'
  | 'connection_read_back'
  | 'sheet_values_match'
  | 'doc_read_back'
  | 'contains_text'
  | 'manual_review'
  | 'custom';

export interface VerificationCheck {
  id: string;
  title: string;
  description?: string;
  kind: VerificationKind;
  required: boolean;
  config?: Record<string, unknown>;
}

export interface AutomationSafetyPolicy {
  autonomyMode: 'manual' | 'safe_reads' | 'semi';
  externalWrite: 'ask' | 'allow' | 'block';
  externalSend: 'ask' | 'block';
  destructive: 'ask_strong' | 'block';
  processExec: 'ask' | 'block';
  maxRuntimeMinutes?: number;
  maxToolCalls?: number;
}

export interface AutomationApprovalPolicy {
  requireApprovalFor?: string[];
  allowAlwaysSafeActions?: boolean;
  externalSendRequiresApproval?: boolean;
  destructiveRequiresApproval?: boolean;
}

/** How an automation writes its run narrative into a chat session. */
export type AutomationChatMode = 'none' | 'append_to_existing' | 'create_new';
export type AutomationChatVisibility = 'private_local' | 'workspace';

export interface Automation {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Chat session this automation writes its run narrative into (see chat-bridge). */
  linkedChatSessionId?: string;
  chatMode?: AutomationChatMode;
  chatVisibility?: AutomationChatVisibility;
  trigger: AutomationTrigger;
  taskTemplate: AutomationTaskTemplate;
  autonomyMode: 'manual' | 'semi' | 'full';
  approvalPolicy: AutomationApprovalPolicy;
  status: AutomationStatus;
  // ── workflow-builder fields (optional for back-compat) ──
  prompt?: string;
  referencedContext?: ReferencedContext[];
  steps?: AutomationStep[];
  verificationChecklist?: VerificationCheck[];
  safetyPolicy?: AutomationSafetyPolicy;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  workspaceId?: string;
  taskRunId?: string;
  queueItemId?: string;
  status: AutomationRunStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  triggerPayload?: Record<string, unknown>;
  /** Linked chat session + the live assistant message the run narrates into. */
  chatSessionId?: string;
  chatMessageId?: string;
}

export interface CreateAutomationInput {
  userId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  chatMode?: AutomationChatMode;
  chatVisibility?: AutomationChatVisibility;
  linkedChatSessionId?: string;
  trigger: AutomationTrigger;
  taskTemplate: AutomationTaskTemplate;
  autonomyMode?: 'manual' | 'semi' | 'full';
  approvalPolicy?: AutomationApprovalPolicy;
  prompt?: string;
  referencedContext?: ReferencedContext[];
  steps?: AutomationStep[];
  verificationChecklist?: VerificationCheck[];
  safetyPolicy?: AutomationSafetyPolicy;
  metadata?: Record<string, unknown>;
}
