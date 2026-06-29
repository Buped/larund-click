// Larund Click — persistent task / conversation memory for the no-mouse operator.
//
// The control loop used to be stateless: every user message started a fresh,
// isolated task with no memory of what came before. That made the agent declare
// success too early, lose the thread on corrections ("no, the sheet is empty"),
// and re-plan from scratch. These types model the *active task* across turns so
// the loop can resume, verify, and respond to corrections instead of resetting.

export type TaskSurface =
  | 'local_files'
  | 'browser'
  | 'connection'
  | 'cli'
  | 'app'
  | 'manual';

export type TaskStatus =
  | 'planning'
  | 'running'
  | 'waiting_user'
  | 'blocked'
  | 'verifying'
  | 'complete'
  | 'failed';

export type TargetDocumentType =
  | 'google_sheet'
  | 'google_doc'
  | 'local_sheet'
  | 'local_doc'
  | 'doc'
  | 'notion_page'
  | 'github_repo'
  | 'unknown';

export interface TargetDocument {
  type: TargetDocumentType;
  title?: string;
  url?: string;
  localPath?: string;
}

export interface ExpectedArtifact {
  type: 'file' | 'browser_page' | 'connection_record' | 'text' | 'table';
  path?: string;
  url?: string;
  description: string;
  rows?: string[][];
  values?: string[];
}

export interface FailedAttempt {
  step: string;
  reason: string;
  tool?: string;
  evidence?: string;
}

export interface UserCorrection {
  message: string;
  interpretation: string;
  timestamp: number;
}

export interface SpreadsheetExpectedScope {
  kind: 'spreadsheet_rows';
  sourcePath: string;
  sheet?: string;
  headerRow: number;
  dataRows: number;
  requiredRows: number[];
  requiredColumns: string[];
  allowPartial: boolean;
}

export interface BulkTaskProgress {
  taskId: string;
  inputCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  allowPartial: boolean;
  items: Array<{
    id: string;
    label: string;
    rowIndex?: number;
    status: 'pending' | 'running' | 'done' | 'failed' | 'ambiguous' | 'skipped' | 'not_found';
    result?: unknown;
    error?: string;
  }>;
}

export interface ActiveTaskState {
  id: string;
  originalUserGoal: string;
  currentGoal: string;
  status: TaskStatus;
  /** Coarse classification from preflight (see control-system/preflight.ts). */
  intent?: string;
  targetApp?: string;
  targetSurface?: TaskSurface;
  targetUrl?: string;
  targetDocument?: TargetDocument;
  expectedOutcome?: string;
  expectedArtifacts?: ExpectedArtifact[];
  expectedData?: {
    rows?: string[][];
    values?: string[];
    source?: string;
  };
  expectedScope?: SpreadsheetExpectedScope;
  bulkProgress?: BulkTaskProgress;
  referencedInputs?: import('../references/types').DocumentReference[];
  filesRead?: string[];
  activeSkills?: import('../skills/types').SkillRuntimeContext[];
  skillVerification?: {
    requiredEvidence: string[];
    completedEvidence: string[];
    blockedReason?: string;
  };
  requiresAuth?: boolean;
  lastKnownState?: string;
  failedAttempts: FailedAttempt[];
  userCorrections: UserCorrection[];
  completedChecks: string[];
  pendingChecks: string[];
  /** Strategies that have been proven wrong and must not be retried. */
  forbiddenStrategies: string[];
  createdAt: number;
  updatedAt: number;
}

/** A compact record of an executed action, used by the completion guard. */
export interface RecentAction {
  action: string;
  argsSummary?: string;
  success: boolean;
  output?: string;
  error?: string;
}

/** Everything the loop assembles to give the model real context each turn. */
export interface TaskContext {
  task: ActiveTaskState;
  /** Prior user/assistant turns (already trimmed to a window). */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  recentActions: RecentAction[];
  /** True when the latest user message was interpreted as a correction. */
  isCorrection: boolean;
}
