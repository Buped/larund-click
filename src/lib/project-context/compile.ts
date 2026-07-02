import { getProject } from '../projects/store';
import { getProjectContext, listProjectSources, upsertProjectContext, recordProjectContextEvent } from './store';
import type { ProjectContextBundle } from './types';

export async function compileProjectContext(projectId: string): Promise<ProjectContextBundle | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const context = await getProjectContext(projectId) ?? await upsertProjectContext(projectId, {});
  const sources = await listProjectSources(projectId);
  const enabledReady = sources.filter((source) => source.isEnabled && source.status === 'ready');
  const bundle: ProjectContextBundle = {
    projectId,
    projectName: project.name,
    projectDescription: project.description,
    brief: context.brief,
    instructions: context.instructions,
    aiSummary: context.aiSummary,
    sourceSummary: context.sourceSummary,
    sourceInventory: sources.map((source) => ({
      id: source.id,
      title: source.title,
      type: source.sourceType,
      summary: source.summary,
      charCount: source.charCount,
      status: source.status,
      isEnabled: source.isEnabled,
    })),
    limits: {
      sourceCount: sources.length,
      totalChars: enabledReady.reduce((sum, source) => sum + source.charCount, 0),
    },
    lastCompiledAt: context.lastCompiledAt ?? context.updatedAt,
  };
  await recordProjectContextEvent(projectId, null, 'context_compiled', { sourceCount: sources.length }).catch(() => undefined);
  return bundle;
}
