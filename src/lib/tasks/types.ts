// Task Dashboard + Evidence data model. Every agent run becomes a TaskRun with a
// timeline of EvidenceEntry records and a set of OutputRefs. This is the
// product-grade, persistent record behind the in-memory session task state.

export type TaskStatus =
  | 'drafting_plan'
  | 'waiting_approval'
  | 'running'
  | 'blocked'
  | 'needs_login'
  | 'needs_input'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AutonomyMode = 'manual' | 'semi' | 'full';

export type OutputRefKind =
  | 'local_file'
  | 'google_doc'
  | 'google_sheet'
  | 'github_pr'
  | 'github_issue'
  | 'url'
  | 'text'
  | 'other';

export interface OutputRef {
  id: string;
  kind: OutputRefKind;
  label: string;
  uri: string;
  metadata?: Record<string, unknown>;
}

export type EvidenceKind =
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'plan'
  | 'complete'
  | 'approval'
  | 'read_back'
  | 'verification'
  | 'visual_verification'
  | 'file_output'
  | 'connection_output'
  | 'error'
  | 'manual_handoff';

export interface EvidenceEntry {
  id: string;
  taskRunId: string;
  userId: string;
  workspaceId?: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  tool?: string;
  risk?: string;
  success?: boolean;
  artifactUri?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface TaskRun {
  id: string;
  userId: string;
  workspaceId?: string;
  sessionId: string;
  title: string;
  originalPrompt: string;
  status: TaskStatus;
  activeSkillIds: string[];
  connectionIds: string[];
  modelId: string;
  autonomyMode: AutonomyMode;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  summary?: string;
  outputRefs: OutputRef[];
  evidenceIds: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateTaskRunInput {
  userId: string;
  workspaceId?: string;
  sessionId: string;
  title: string;
  originalPrompt: string;
  modelId: string;
  autonomyMode: AutonomyMode;
  activeSkillIds?: string[];
  connectionIds?: string[];
  status?: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface AddEvidenceInput {
  taskRunId: string;
  userId: string;
  workspaceId?: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  tool?: string;
  risk?: string;
  success?: boolean;
  artifactUri?: string;
  metadata?: Record<string, unknown>;
}
