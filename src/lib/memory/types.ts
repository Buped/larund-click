// Memory Center types. Structured long-term memory — NOT chat history. Entries
// are scoped, typed, lifecycle-managed and provenance-tracked so the user stays
// in control of what the agent "knows".
//
// Phase 2 adds a lifecycle (`status`), a richer `scope`, provenance links to the
// task/evidence that produced a memory, sensitivity + write policy, and an
// embedding placeholder. All new fields are optional on input and defaulted on
// create / normalized on read so Phase 1 entries keep working.

export type MemoryType =
  | 'user_profile'
  | 'workspace'
  | 'project'
  | 'procedural'
  | 'episodic'
  | 'evidence'
  | 'preference'
  | 'correction';

export type MemorySource = 'user' | 'agent' | 'task' | 'document' | 'correction' | 'system';

/** Lifecycle state. Only `active` memory is used in prompts. */
export type MemoryStatus = 'active' | 'suggested' | 'needs_review' | 'archived' | 'rejected';

/** Where a memory applies. `global` = user-wide; others narrow the scope. */
export type MemoryScope = 'global' | 'workspace' | 'project' | 'skill';

export type MemorySensitivity = 'normal' | 'private' | 'secret_reference';

export type MemoryWritePolicy = 'manual_only' | 'suggest_then_confirm' | 'auto_low_risk';

export interface MemoryEntry {
  id: string;
  userId: string;
  workspaceId?: string;
  projectId?: string;
  /** Skill id this memory is bound to, when scope === 'skill'. */
  skillId?: string;
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  source: MemorySource;
  /** 0..1 — how strongly we trust this. User-created = high, auto-extracted = lower. */
  confidence: number;
  status: MemoryStatus;
  scope: MemoryScope;
  sensitivity: MemorySensitivity;
  writePolicy: MemoryWritePolicy;
  pinned: boolean;
  /** Kept for Phase 1 back-compat; mirrors `status === 'archived'`. */
  archived: boolean;
  sourceTaskRunId?: string;
  sourceEvidenceId?: string;
  /** Id of a memory this one supersedes (older, now inactive). */
  supersedesId?: string;
  /** Id of a memory that contradicts this one (flagged for review). */
  contradictsId?: string;
  expiresAt?: string;
  /** Placeholder for future vector search; not used by the lexical retriever. */
  embeddingText?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMemoryInput {
  userId: string;
  workspaceId?: string;
  projectId?: string;
  skillId?: string;
  type: MemoryType;
  title: string;
  content: string;
  tags?: string[];
  source?: MemorySource;
  confidence?: number;
  status?: MemoryStatus;
  scope?: MemoryScope;
  sensitivity?: MemorySensitivity;
  writePolicy?: MemoryWritePolicy;
  pinned?: boolean;
  sourceTaskRunId?: string;
  sourceEvidenceId?: string;
  supersedesId?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryPatch = Partial<Omit<MemoryEntry, 'id' | 'userId' | 'createdAt'>>;

export interface MemoryQuery {
  userId: string;
  workspaceId?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  status?: MemoryStatus | MemoryStatus[];
  tags?: string[];
  query?: string;
  includeArchived?: boolean;
}

export interface RelevantMemoryQuery {
  task: string;
  userId: string;
  workspaceId?: string;
  limit?: number;
}

/** A scored entry returned by the retriever. */
export interface ScoredMemory {
  entry: MemoryEntry;
  score: number;
}
