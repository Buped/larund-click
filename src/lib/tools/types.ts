import type { ControlAction, ControlActionName, ControlToolResult, ToolRisk } from '../control-system/types';
import type { DocumentReference } from '../references/types';
import type { SkillRuntimeContext } from '../skills/types';

export type { ToolRisk } from '../control-system/types';

export type ToolCategory =
  | 'runtime'
  | 'files'
  | 'documents'
  | 'artifacts'
  | 'browser'
  | 'web'
  | 'apps'
  | 'data'
  | 'clipboard'
  | 'connections'
  | 'skills'
  | 'workflows'
  | 'approvals';

export type ApprovalMode = 'never' | 'on_risk' | 'always';

export interface AuditEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  action: ControlActionName;
  argsSummary: string;
  risk: ToolRisk;
  category: ToolCategory;
  success?: boolean;
  outputSummary?: string;
  error?: string;
  durationMs?: number;
  costUsd?: number;
  approvalId?: string;
  skill?: string;
  workflowId?: string;
  toolSource?: 'builtin' | 'connection' | 'mcp' | 'custom_api' | 'workflow' | 'skill';
  sourceId?: string;
  metadataHash?: string;
  sandboxDecision?: string;
  promptToolSnapshot?: string;
}

export interface AuditLogger {
  record(entry: AuditEntry): void;
  list(): AuditEntry[];
}

export interface ApprovalRequest {
  id: string;
  action: ControlAction;
  risk: ToolRisk;
  reason: string;
  argsSummary: string;
  preview?: string;
  createdAt: number;
}

export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

export interface ApprovalService {
  /** Returns true when the action may proceed. */
  request(req: Omit<ApprovalRequest, 'id' | 'createdAt'>): Promise<boolean>;
  /** Pre-grant a tool/skill so future matching actions auto-approve. */
  grantAlways(actionName: string): void;
}

export interface ConnectionCallResult {
  success: boolean;
  output: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ConnectionRegistry {
  call(connection: string, tool: string, args: Record<string, unknown>): Promise<ConnectionCallResult>;
  isConfigured(connection: string): boolean;
}

export interface SkillRunner {
  run(skill: string, input: Record<string, unknown> | string): Promise<ControlToolResult>;
}

export interface WorkflowRunner {
  start(workflow: string, input: Record<string, unknown> | string): Promise<ControlToolResult>;
  status(workflowId: string): Promise<ControlToolResult>;
  cancel(workflowId: string): Promise<ControlToolResult>;
}

export interface ToolContext {
  userId: string;
  sessionId: string;
  workspaceRoot: string;
  task: string;
  references?: DocumentReference[];
  addCost?: (usd: number) => void;
  audit: AuditLogger;
  approvals: ApprovalService;
  connections?: ConnectionRegistry;
  skills?: SkillRunner;
  workflows?: WorkflowRunner;
  onAskUser?: (question: string) => Promise<string>;
  activeSkills?: SkillRuntimeContext[];
}

export interface ToolDefinition<TArgs extends ControlAction = ControlAction> {
  name: ControlActionName;
  description: string;
  category: ToolCategory;
  risk: ToolRisk | ((args: TArgs) => ToolRisk);
  requiresApproval?: ApprovalMode;
  run(args: TArgs, ctx: ToolContext): Promise<ControlToolResult>;
}
