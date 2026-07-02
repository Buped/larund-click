export type ProjectSourceType = 'upload_text' | 'pasted_text';
export type ProjectSourceStatus = 'processing' | 'ready' | 'failed' | 'disabled';
export type ProjectContextEventType =
  | 'context_created'
  | 'brief_updated'
  | 'instructions_updated'
  | 'source_added'
  | 'source_deleted'
  | 'source_reindexed'
  | 'source_disabled'
  | 'context_compiled'
  | 'retrieval_used';

export interface ProjectContext {
  id: string;
  projectId: string;
  brief: string;
  instructions: string;
  aiSummary: string;
  sourceSummary: string;
  contextVersion: number;
  lastCompiledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectContextPatch {
  brief?: string;
  instructions?: string;
  aiSummary?: string;
  sourceSummary?: string;
}

export interface ProjectSource {
  id: string;
  projectId: string;
  createdByUserId: string;
  title: string;
  sourceType: ProjectSourceType;
  fileName?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  contentText: string;
  contentSha256: string;
  charCount: number;
  byteSize: number;
  tokenEstimate: number;
  summary: string;
  status: ProjectSourceStatus;
  errorMessage?: string | null;
  isEnabled: boolean;
  metadataJson: Record<string, unknown>;
  lastIndexedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount?: number;
}

export interface ProjectSourceChunk {
  id: string;
  sourceId: string;
  projectId: string;
  chunkIndex: number;
  heading?: string | null;
  content: string;
  charCount: number;
  tokenEstimate: number;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface CreateProjectSourceInput {
  projectId: string;
  createdByUserId: string;
  title: string;
  sourceType: ProjectSourceType;
  contentText: string;
  fileName?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  metadataJson?: Record<string, unknown>;
}

export interface RetrievedProjectChunk {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
  citationLabel: string;
}

export interface RetrieveProjectContextInput {
  projectId: string;
  query: string;
  limit?: number;
  sourceIds?: string[];
  includeQuotes?: boolean;
}

export interface ProjectContextBundle {
  projectId: string;
  projectName: string;
  projectDescription: string;
  brief: string;
  instructions: string;
  aiSummary: string;
  sourceSummary: string;
  sourceInventory: Array<{
    id: string;
    title: string;
    type: string;
    summary: string;
    charCount: number;
    status: ProjectSourceStatus;
    isEnabled: boolean;
  }>;
  limits: {
    sourceCount: number;
    totalChars: number;
  };
  lastCompiledAt?: string | null;
}

export interface ProjectContextUsageMetadata {
  project_context_used: boolean;
  project_id: string;
  searched_project_sources: number;
  project_sources_used: Array<{
    sourceId: string;
    title: string;
    chunkIds: string[];
    quotePreview: string;
  }>;
}
