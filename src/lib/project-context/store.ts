import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import {
  chunkProjectSourceText,
  estimateTokens,
  extractiveSummary,
  normalizeProjectSourceText,
  sha256Hex,
} from './chunk';
import { PROJECT_CONTEXT_ERRORS, PROJECT_CONTEXT_LIMITS } from './limits';
import type {
  CreateProjectSourceInput,
  ProjectContext,
  ProjectContextEventType,
  ProjectContextPatch,
  ProjectSource,
  ProjectSourceChunk,
  ProjectSourceStatus,
  ProjectSourceType,
} from './types';

const CONTEXT_TABLE = 'larund_project_context';
const SOURCES_TABLE = 'larund_project_sources';
const CHUNKS_TABLE = 'larund_project_source_chunks';
const EVENTS_TABLE = 'larund_project_context_events';

type ContextRow = {
  id: string;
  project_id: string;
  brief: string;
  instructions: string;
  ai_summary: string;
  source_summary: string;
  context_version: number;
  last_compiled_at: string | null;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  project_id: string;
  created_by_user_id: string;
  title: string;
  source_type: ProjectSourceType;
  file_name: string | null;
  mime_type: string | null;
  extension: string | null;
  content_text: string;
  content_sha256: string;
  char_count: number;
  byte_size: number;
  token_estimate: number;
  summary: string;
  status: ProjectSourceStatus;
  error_message: string | null;
  is_enabled: boolean;
  metadata_json: Record<string, unknown>;
  last_indexed_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  chunk_count?: number;
};

type ChunkRow = {
  id: string;
  source_id: string;
  project_id: string;
  chunk_index: number;
  heading: string | null;
  content: string;
  char_count: number;
  token_estimate: number;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export interface ProjectContextBackend {
  getProjectContext(projectId: string): Promise<ProjectContext | null>;
  upsertProjectContext(projectId: string, patch: ProjectContextPatch): Promise<ProjectContext>;
  listProjectSources(projectId: string): Promise<ProjectSource[]>;
  getProjectSource(sourceId: string): Promise<ProjectSource | null>;
  createProjectSource(input: CreateProjectSourceInput): Promise<ProjectSource>;
  deleteProjectSource(sourceId: string): Promise<void>;
  setProjectSourceEnabled(sourceId: string, enabled: boolean): Promise<void>;
  reindexProjectSource(sourceId: string): Promise<ProjectSource>;
  listProjectSourceChunks(projectId: string): Promise<ProjectSourceChunk[]>;
  listChunksForSource(sourceId: string): Promise<ProjectSourceChunk[]>;
  markSourcesUsed(sourceIds: string[]): Promise<void>;
  recordEvent(projectId: string, userId: string | null, eventType: ProjectContextEventType, details?: Record<string, unknown>): Promise<void>;
}

function toContext(row: ContextRow): ProjectContext {
  return {
    id: row.id,
    projectId: row.project_id,
    brief: row.brief ?? '',
    instructions: row.instructions ?? '',
    aiSummary: row.ai_summary ?? '',
    sourceSummary: row.source_summary ?? '',
    contextVersion: row.context_version ?? 1,
    lastCompiledAt: row.last_compiled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSource(row: SourceRow): ProjectSource {
  return {
    id: row.id,
    projectId: row.project_id,
    createdByUserId: row.created_by_user_id,
    title: row.title,
    sourceType: row.source_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    extension: row.extension,
    contentText: row.content_text,
    contentSha256: row.content_sha256,
    charCount: row.char_count,
    byteSize: row.byte_size,
    tokenEstimate: row.token_estimate,
    summary: row.summary ?? '',
    status: row.status,
    errorMessage: row.error_message,
    isEnabled: row.is_enabled,
    metadataJson: row.metadata_json ?? {},
    lastIndexedAt: row.last_indexed_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chunkCount: row.chunk_count,
  };
}

function toChunk(row: ChunkRow): ProjectSourceChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    projectId: row.project_id,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    content: row.content,
    charCount: row.char_count,
    tokenEstimate: row.token_estimate,
    metadataJson: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

function sourceToRow(source: ProjectSource): SourceRow {
  return {
    id: source.id,
    project_id: source.projectId,
    created_by_user_id: source.createdByUserId,
    title: source.title,
    source_type: source.sourceType,
    file_name: source.fileName ?? null,
    mime_type: source.mimeType ?? null,
    extension: source.extension ?? null,
    content_text: source.contentText,
    content_sha256: source.contentSha256,
    char_count: source.charCount,
    byte_size: source.byteSize,
    token_estimate: source.tokenEstimate,
    summary: source.summary,
    status: source.status,
    error_message: source.errorMessage ?? null,
    is_enabled: source.isEnabled,
    metadata_json: source.metadataJson,
    last_indexed_at: source.lastIndexedAt ?? null,
    last_used_at: source.lastUsedAt ?? null,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
    chunk_count: source.chunkCount,
  };
}

function chunkToRow(chunk: ProjectSourceChunk): ChunkRow {
  return {
    id: chunk.id,
    source_id: chunk.sourceId,
    project_id: chunk.projectId,
    chunk_index: chunk.chunkIndex,
    heading: chunk.heading ?? null,
    content: chunk.content,
    char_count: chunk.charCount,
    token_estimate: chunk.tokenEstimate,
    metadata_json: chunk.metadataJson,
    created_at: chunk.createdAt,
  };
}

async function preparedSource(input: CreateProjectSourceInput, existing: ProjectSource[]): Promise<{ source: ProjectSource; chunks: ProjectSourceChunk[] }> {
  const contentText = normalizeProjectSourceText(input.contentText);
  if (contentText.length > PROJECT_CONTEXT_LIMITS.maxCharsPerSource) throw new Error(PROJECT_CONTEXT_ERRORS.fileTooLarge);
  if (existing.length >= PROJECT_CONTEXT_LIMITS.maxSourcesPerProject) throw new Error(PROJECT_CONTEXT_ERRORS.sourceLimit);
  const totalChars = existing.filter((s) => s.status !== 'failed').reduce((sum, s) => sum + s.charCount, 0) + contentText.length;
  if (totalChars > PROJECT_CONTEXT_LIMITS.maxCharsPerProject) throw new Error(PROJECT_CONTEXT_ERRORS.totalTextLimit);

  const contentSha256 = await sha256Hex(contentText);
  if (existing.some((s) => s.contentSha256 === contentSha256)) throw new Error(PROJECT_CONTEXT_ERRORS.duplicate);

  const now = new Date().toISOString();
  const id = uuidv4();
  const chunks = chunkProjectSourceText({ projectId: input.projectId, sourceId: id, text: contentText, now })
    .map((chunk) => ({ ...chunk, id: uuidv4() }));
  const source: ProjectSource = {
    id,
    projectId: input.projectId,
    createdByUserId: input.createdByUserId,
    title: input.title.trim() || input.fileName || 'Untitled source',
    sourceType: input.sourceType,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    extension: input.extension ?? null,
    contentText,
    contentSha256,
    charCount: contentText.length,
    byteSize: new TextEncoder().encode(contentText).byteLength,
    tokenEstimate: estimateTokens(contentText),
    summary: extractiveSummary(contentText, input.title || input.fileName || 'Source'),
    status: 'ready',
    errorMessage: null,
    isEnabled: true,
    metadataJson: input.metadataJson ?? {},
    lastIndexedAt: now,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    chunkCount: chunks.length,
  };
  return { source, chunks };
}

export class SupabaseProjectContextBackend implements ProjectContextBackend {
  async getProjectContext(projectId: string): Promise<ProjectContext | null> {
    const { data, error } = await supabase.from(CONTEXT_TABLE).select('*').eq('project_id', projectId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toContext(data as ContextRow) : null;
  }

  async upsertProjectContext(projectId: string, patch: ProjectContextPatch): Promise<ProjectContext> {
    const row: Partial<ContextRow> = { project_id: projectId };
    if (patch.brief !== undefined) row.brief = patch.brief;
    if (patch.instructions !== undefined) row.instructions = patch.instructions;
    if (patch.aiSummary !== undefined) row.ai_summary = patch.aiSummary;
    if (patch.sourceSummary !== undefined) row.source_summary = patch.sourceSummary;
    const { data, error } = await supabase
      .from(CONTEXT_TABLE)
      .upsert(row, { onConflict: 'project_id' })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return toContext(data as ContextRow);
  }

  async listProjectSources(projectId: string): Promise<ProjectSource[]> {
    const { data, error } = await supabase
      .from(SOURCES_TABLE)
      .select('*, larund_project_source_chunks(count)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<SourceRow & { larund_project_source_chunks?: Array<{ count: number }> }>).map((row) =>
      toSource({ ...row, chunk_count: row.larund_project_source_chunks?.[0]?.count ?? undefined }),
    );
  }

  async getProjectSource(sourceId: string): Promise<ProjectSource | null> {
    const { data, error } = await supabase.from(SOURCES_TABLE).select('*').eq('id', sourceId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toSource(data as SourceRow) : null;
  }

  async createProjectSource(input: CreateProjectSourceInput): Promise<ProjectSource> {
    const existing = await this.listProjectSources(input.projectId);
    const currentChunks = await this.listProjectSourceChunks(input.projectId);
    const prepared = await preparedSource(input, existing);
    if (currentChunks.length + prepared.chunks.length > PROJECT_CONTEXT_LIMITS.maxChunksPerProject) throw new Error(PROJECT_CONTEXT_ERRORS.chunkLimit);

    const { error } = await supabase.from(SOURCES_TABLE).insert(sourceToRow(prepared.source));
    if (error) {
      if (/duplicate|content_sha256/i.test(error.message)) throw new Error(PROJECT_CONTEXT_ERRORS.duplicate);
      throw new Error(error.message);
    }
    const { error: chunkError } = await supabase.from(CHUNKS_TABLE).insert(prepared.chunks.map(chunkToRow));
    if (chunkError) {
      await supabase.from(SOURCES_TABLE).update({ status: 'failed', error_message: chunkError.message }).eq('id', prepared.source.id);
      throw new Error(chunkError.message);
    }
    await this.recompileSourceSummary(input.projectId);
    await this.recordEvent(input.projectId, input.createdByUserId, 'source_added', { sourceId: prepared.source.id, title: prepared.source.title });
    return prepared.source;
  }

  async deleteProjectSource(sourceId: string): Promise<void> {
    const source = await this.getProjectSource(sourceId);
    const { error } = await supabase.from(SOURCES_TABLE).delete().eq('id', sourceId);
    if (error) throw new Error(error.message);
    if (source) {
      await this.recompileSourceSummary(source.projectId);
      await this.recordEvent(source.projectId, null, 'source_deleted', { sourceId, title: source.title });
    }
  }

  async setProjectSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
    const source = await this.getProjectSource(sourceId);
    const { error } = await supabase
      .from(SOURCES_TABLE)
      .update({ is_enabled: enabled, status: enabled ? 'ready' : 'disabled' })
      .eq('id', sourceId);
    if (error) throw new Error(error.message);
    if (source) await this.recordEvent(source.projectId, null, 'source_disabled', { sourceId, enabled });
  }

  async reindexProjectSource(sourceId: string): Promise<ProjectSource> {
    const source = await this.getProjectSource(sourceId);
    if (!source) throw new Error('source not found');
    const now = new Date().toISOString();
    const chunks = chunkProjectSourceText({ projectId: source.projectId, sourceId: source.id, text: source.contentText, now }).map((chunk) => ({ ...chunk, id: uuidv4() }));
    const projectChunks = await this.listProjectSourceChunks(source.projectId);
    const currentSourceChunks = projectChunks.filter((c) => c.sourceId === sourceId).length;
    if (projectChunks.length - currentSourceChunks + chunks.length > PROJECT_CONTEXT_LIMITS.maxChunksPerProject) throw new Error(PROJECT_CONTEXT_ERRORS.chunkLimit);
    await supabase.from(CHUNKS_TABLE).delete().eq('source_id', sourceId);
    const { error: chunkError } = await supabase.from(CHUNKS_TABLE).insert(chunks.map(chunkToRow));
    if (chunkError) throw new Error(chunkError.message);
    const { data, error } = await supabase
      .from(SOURCES_TABLE)
      .update({
        status: 'ready',
        error_message: null,
        summary: extractiveSummary(source.contentText, source.title),
        last_indexed_at: now,
      })
      .eq('id', sourceId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    await this.recompileSourceSummary(source.projectId);
    await this.recordEvent(source.projectId, null, 'source_reindexed', { sourceId });
    return toSource({ ...(data as SourceRow), chunk_count: chunks.length });
  }

  async listProjectSourceChunks(projectId: string): Promise<ProjectSourceChunk[]> {
    const { data, error } = await supabase
      .from(CHUNKS_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .order('chunk_index', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ChunkRow[]).map(toChunk);
  }

  async listChunksForSource(sourceId: string): Promise<ProjectSourceChunk[]> {
    const { data, error } = await supabase
      .from(CHUNKS_TABLE)
      .select('*')
      .eq('source_id', sourceId)
      .order('chunk_index', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ChunkRow[]).map(toChunk);
  }

  async markSourcesUsed(sourceIds: string[]): Promise<void> {
    if (!sourceIds.length) return;
    await supabase.from(SOURCES_TABLE).update({ last_used_at: new Date().toISOString() }).in('id', [...new Set(sourceIds)]);
  }

  async recordEvent(projectId: string, userId: string | null, eventType: ProjectContextEventType, details: Record<string, unknown> = {}): Promise<void> {
    if (!userId && eventType !== 'retrieval_used' && eventType !== 'source_deleted' && eventType !== 'source_reindexed' && eventType !== 'source_disabled' && eventType !== 'context_compiled') return;
    const row: Record<string, unknown> = {
      project_id: projectId,
      event_type: eventType,
      details_json: details,
    };
    if (userId) row.user_id = userId;
    await supabase.from(EVENTS_TABLE).insert(row).then(() => undefined);
  }

  private async recompileSourceSummary(projectId: string): Promise<void> {
    const sources = await this.listProjectSources(projectId);
    const summary = sources
      .filter((s) => s.isEnabled && s.status === 'ready')
      .slice(0, 8)
      .map((s) => `- ${s.title}: ${s.summary.slice(0, 260)}`)
      .join('\n');
    await this.upsertProjectContext(projectId, { sourceSummary: summary });
  }
}

export class InMemoryProjectContextBackend implements ProjectContextBackend {
  contexts = new Map<string, ProjectContext>();
  sources = new Map<string, ProjectSource>();
  chunks = new Map<string, ProjectSourceChunk>();
  events: Array<{ projectId: string; userId: string | null; eventType: ProjectContextEventType; details: Record<string, unknown> }> = [];

  async getProjectContext(projectId: string): Promise<ProjectContext | null> {
    return structuredClone(this.contexts.get(projectId) ?? null);
  }

  async upsertProjectContext(projectId: string, patch: ProjectContextPatch): Promise<ProjectContext> {
    const now = new Date().toISOString();
    const existing = this.contexts.get(projectId);
    const context: ProjectContext = {
      id: existing?.id ?? uuidv4(),
      projectId,
      brief: patch.brief ?? existing?.brief ?? '',
      instructions: patch.instructions ?? existing?.instructions ?? '',
      aiSummary: patch.aiSummary ?? existing?.aiSummary ?? '',
      sourceSummary: patch.sourceSummary ?? existing?.sourceSummary ?? '',
      contextVersion: existing?.contextVersion ?? 1,
      lastCompiledAt: existing?.lastCompiledAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.contexts.set(projectId, context);
    return structuredClone(context);
  }

  async listProjectSources(projectId: string): Promise<ProjectSource[]> {
    return [...this.sources.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ ...structuredClone(s), chunkCount: [...this.chunks.values()].filter((c) => c.sourceId === s.id).length }));
  }

  async getProjectSource(sourceId: string): Promise<ProjectSource | null> {
    const source = this.sources.get(sourceId);
    return source ? structuredClone(source) : null;
  }

  async createProjectSource(input: CreateProjectSourceInput): Promise<ProjectSource> {
    const existing = await this.listProjectSources(input.projectId);
    const prepared = await preparedSource(input, existing);
    if ([...this.chunks.values()].filter((c) => c.projectId === input.projectId).length + prepared.chunks.length > PROJECT_CONTEXT_LIMITS.maxChunksPerProject) throw new Error(PROJECT_CONTEXT_ERRORS.chunkLimit);
    this.sources.set(prepared.source.id, prepared.source);
    for (const chunk of prepared.chunks) this.chunks.set(chunk.id, chunk);
    await this.recompileSourceSummary(input.projectId);
    await this.recordEvent(input.projectId, input.createdByUserId, 'source_added', { sourceId: prepared.source.id });
    return structuredClone(prepared.source);
  }

  async deleteProjectSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    this.sources.delete(sourceId);
    for (const chunk of [...this.chunks.values()]) if (chunk.sourceId === sourceId) this.chunks.delete(chunk.id);
    if (source) await this.recompileSourceSummary(source.projectId);
  }

  async setProjectSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('source not found');
    source.isEnabled = enabled;
    source.status = enabled ? 'ready' : 'disabled';
    source.updatedAt = new Date().toISOString();
  }

  async reindexProjectSource(sourceId: string): Promise<ProjectSource> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('source not found');
    for (const chunk of [...this.chunks.values()]) if (chunk.sourceId === sourceId) this.chunks.delete(chunk.id);
    const now = new Date().toISOString();
    const chunks = chunkProjectSourceText({ projectId: source.projectId, sourceId, text: source.contentText, now }).map((chunk) => ({ ...chunk, id: uuidv4() }));
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
    source.summary = extractiveSummary(source.contentText, source.title);
    source.lastIndexedAt = now;
    source.status = 'ready';
    source.chunkCount = chunks.length;
    await this.recompileSourceSummary(source.projectId);
    return structuredClone(source);
  }

  async listProjectSourceChunks(projectId: string): Promise<ProjectSourceChunk[]> {
    return [...this.chunks.values()].filter((c) => c.projectId === projectId).sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => structuredClone(c));
  }

  async listChunksForSource(sourceId: string): Promise<ProjectSourceChunk[]> {
    return [...this.chunks.values()].filter((c) => c.sourceId === sourceId).sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => structuredClone(c));
  }

  async markSourcesUsed(sourceIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of sourceIds) {
      const source = this.sources.get(id);
      if (source) source.lastUsedAt = now;
    }
  }

  async recordEvent(projectId: string, userId: string | null, eventType: ProjectContextEventType, details: Record<string, unknown> = {}): Promise<void> {
    this.events.push({ projectId, userId, eventType, details });
  }

  private async recompileSourceSummary(projectId: string): Promise<void> {
    const sources = await this.listProjectSources(projectId);
    const sourceSummary = sources.filter((s) => s.isEnabled && s.status === 'ready').map((s) => `- ${s.title}: ${s.summary.slice(0, 260)}`).join('\n');
    await this.upsertProjectContext(projectId, { sourceSummary });
  }
}

let backend: ProjectContextBackend = new SupabaseProjectContextBackend();

export function setProjectContextBackendForTests(next: ProjectContextBackend): void {
  backend = next;
}

export function resetProjectContextBackend(): void {
  backend = new SupabaseProjectContextBackend();
}

export async function getProjectContext(projectId: string): Promise<ProjectContext | null> {
  return backend.getProjectContext(projectId);
}

export async function upsertProjectContext(projectId: string, patch: ProjectContextPatch): Promise<ProjectContext> {
  return backend.upsertProjectContext(projectId, patch);
}

export async function listProjectSources(projectId: string): Promise<ProjectSource[]> {
  return backend.listProjectSources(projectId);
}

export async function getProjectSource(sourceId: string): Promise<ProjectSource | null> {
  return backend.getProjectSource(sourceId);
}

export async function createProjectSource(input: CreateProjectSourceInput): Promise<ProjectSource> {
  return backend.createProjectSource(input);
}

export async function deleteProjectSource(sourceId: string): Promise<void> {
  return backend.deleteProjectSource(sourceId);
}

export async function setProjectSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  return backend.setProjectSourceEnabled(sourceId, enabled);
}

export async function reindexProjectSource(sourceId: string): Promise<ProjectSource> {
  return backend.reindexProjectSource(sourceId);
}

export async function listProjectSourceChunks(projectId: string): Promise<ProjectSourceChunk[]> {
  return backend.listProjectSourceChunks(projectId);
}

export async function listChunksForSource(sourceId: string): Promise<ProjectSourceChunk[]> {
  return backend.listChunksForSource(sourceId);
}

export async function markProjectSourcesUsed(sourceIds: string[]): Promise<void> {
  return backend.markSourcesUsed(sourceIds);
}

export async function recordProjectContextEvent(projectId: string, userId: string | null, eventType: ProjectContextEventType, details?: Record<string, unknown>): Promise<void> {
  return backend.recordEvent(projectId, userId, eventType, details);
}
