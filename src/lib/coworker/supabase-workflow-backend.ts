import { supabase } from '../supabase';
import type { RecordBackend, RecordRow } from './persistence';

const REMOTE_COLLECTIONS = new Set([
  'automations',
  'automation_runs',
  'task_queue',
  'task_runs',
  'task_evidence',
  'builder_skills',
  'skill_learning_events',
  'skill_usage_events',
  'workflow_templates',
  'mcp_servers',
  'mcp_tool_snapshots',
  'custom_api_connections',
  'custom_api_tools',
]);

type ProjectRecordRow = {
  collection: string;
  id: string;
  project_id: string;
  data: RecordRow;
};

export function isProjectWorkflowCollection(collection: string): boolean {
  return REMOTE_COLLECTIONS.has(collection);
}

function projectIdOf(row: RecordRow): string | null {
  const direct = row.projectId ?? row.workspaceId;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const metadata = row.metadata;
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as Record<string, unknown>;
    const scoped = meta.projectId ?? meta.workspaceId;
    if (typeof scoped === 'string' && scoped.trim()) return scoped;
  }
  return null;
}

export class SupabaseWorkflowRecordBackend implements RecordBackend {
  async all(collection: string): Promise<RecordRow[]> {
    const { data, error } = await supabase
      .from('larund_project_records')
      .select('data')
      .eq('collection', collection);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Pick<ProjectRecordRow, 'data'>>).map((r) => r.data);
  }

  async get(collection: string, id: string): Promise<RecordRow | null> {
    const { data, error } = await supabase
      .from('larund_project_records')
      .select('data')
      .eq('collection', collection)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Pick<ProjectRecordRow, 'data'> | null)?.data ?? null;
  }

  async put(collection: string, row: RecordRow): Promise<void> {
    const projectId = projectIdOf(row);
    if (!projectId) throw new Error(`project_id_required:${collection}:${row.id}`);
    const { error } = await supabase
      .from('larund_project_records')
      .upsert({
        collection,
        id: row.id,
        project_id: projectId,
        data: row,
      }, { onConflict: 'collection,id' });
    if (error) throw new Error(error.message);
  }

  async delete(collection: string, id: string): Promise<void> {
    const { error } = await supabase
      .from('larund_project_records')
      .delete()
      .eq('collection', collection)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}

export class HybridWorkflowRecordBackend implements RecordBackend {
  constructor(
    private readonly local: RecordBackend,
    private readonly remote: RecordBackend,
  ) {}

  async all(collection: string): Promise<RecordRow[]> {
    if (!isProjectWorkflowCollection(collection)) return this.local.all(collection);
    const [remoteRows, localRows] = await Promise.all([
      this.remote.all(collection).catch((error) => {
        console.warn(`Supabase workflow collection unavailable: ${collection}`, error);
        return [] as RecordRow[];
      }),
      this.local.all(collection),
    ]);
    const byId = new Map<string, RecordRow>();
    for (const row of localRows) byId.set(row.id, row);
    for (const row of remoteRows) byId.set(row.id, row);
    return [...byId.values()];
  }

  async get(collection: string, id: string): Promise<RecordRow | null> {
    if (!isProjectWorkflowCollection(collection)) return this.local.get(collection, id);
    const remoteRow = await this.remote.get(collection, id).catch((error) => {
      console.warn(`Supabase workflow record unavailable: ${collection}/${id}`, error);
      return null;
    });
    return remoteRow ?? this.local.get(collection, id);
  }

  async put(collection: string, row: RecordRow): Promise<void> {
    if (!isProjectWorkflowCollection(collection) || !projectIdOf(row)) {
      await this.local.put(collection, row);
      return;
    }
    await this.remote.put(collection, row);
    await this.local.delete(collection, row.id).catch(() => undefined);
  }

  async delete(collection: string, id: string): Promise<void> {
    if (isProjectWorkflowCollection(collection)) {
      await this.remote.delete(collection, id).catch((error) => {
        console.warn(`Supabase workflow delete unavailable: ${collection}/${id}`, error);
      });
    }
    await this.local.delete(collection, id);
  }
}
