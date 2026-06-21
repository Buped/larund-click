// Coworker run context — the bridge between the agent loop and the Coworker Core
// stores (workspaces, memory, skills, tasks). Everything here is best-effort and
// defensive: if any store fails, the loop must still run. This keeps the core
// no-mouse loop decoupled from persistence while giving it workspace context,
// relevant memory, relevant skills, and a persistent task/evidence record.

import { getWorkspace, resolveActiveWorkspace, setActiveWorkspace } from '../workspaces/store';
import { primaryLocalRoot, renderWorkspaceSummary } from '../workspaces/registry';
import type { Workspace } from '../workspaces/types';
import { getRelevantMemory, markMemoryUsed } from '../memory/store';
import { renderRelevantMemory } from '../memory/prompt';
import { listRichSkillManifestsAsync } from '../skills/runner';
import { routeSkills, renderSkillRoutePrompt, type SkillRouterResult } from '../skills/router';
import { TOOL_CATALOG } from '../tools/registry';
import { availableConnectionIds } from '../connections/hub/store';
import {
  addEvidence,
  addOutputRef,
  createTaskRun,
  setTaskStatus,
} from '../tasks/store';
import { stepToEvidence, stepToOutputRef, type StepLike } from '../tasks/evidence';
import type { AutonomyMode, TaskRun, TaskStatus } from '../tasks/types';
import { getRoleTemplate } from '../roles/templates';
import { renderRolePrompt } from '../roles/prompt';
import { getWorkflowTemplate, renderWorkflowPrompt } from '../workflows/templates/store';

export interface CoworkerPromptContext {
  workspace?: Workspace;
  /** The workspace's primary local folder, used as the agent working dir. */
  workspaceRoot?: string;
  /** Pre-rendered prompt sections (empty string when nothing relevant). */
  promptBlock: string;
  /** Memory entry ids that were surfaced, for markMemoryUsed after the run. */
  usedMemoryIds: string[];
  /** Role + workflow template selected for this run, for task metadata. */
  roleId?: string;
  workflowTemplateId?: string;
  skillRoute?: SkillRouterResult;
}

/**
 * Resolve the active workspace and build the compact prompt additions
 * (workspace summary + role + relevant memory + relevant skills + workflow).
 * Never throws.
 */
export async function buildCoworkerPromptContext(args: {
  userId: string;
  sessionId: string;
  task: string;
  workspaceId?: string;
  roleId?: string;
  workflowTemplateId?: string;
}): Promise<CoworkerPromptContext> {
  try {
    // An explicit workspaceId (chosen in the UI) wins; otherwise fall back to the
    // session's active workspace or the user's default.
    let workspace = null;
    if (args.workspaceId) {
      const explicit = await getWorkspace(args.workspaceId);
      if (explicit && explicit.userId === args.userId && !explicit.archivedAt) {
        setActiveWorkspace(args.sessionId, explicit.id);
        workspace = explicit;
      }
    }
    if (!workspace) workspace = await resolveActiveWorkspace(args.sessionId, args.userId);
    const sections: string[] = [];

    // Connections available in this workspace, for skill ranking.
    let connIds: string[] = [];
    try {
      connIds = await availableConnectionIds({ userId: args.userId, workspaceId: workspace.id });
    } catch {
      connIds = workspace.connectedProviderIds;
    }

    sections.push(`## Workspace context\n${renderWorkspaceSummary(workspace, { enabledConnectionNames: connIds })}`);

    // Selected role (explicit or workspace default) shapes prompt + skill ranking.
    const role = getRoleTemplate(args.roleId ?? '') ;
    if (role) sections.push(renderRolePrompt(role));

    // Relevant long-term memory (active only; provenance-tagged).
    const scored = await getRelevantMemory({ task: args.task, userId: args.userId, workspaceId: workspace.id });
    const memoryBlock = renderRelevantMemory(scored);
    if (memoryBlock) sections.push(memoryBlock);

    // Relevant, workspace-enabled skills (bundled + custom builder skills),
    // biased by the selected role's preferred skills/categories.
    const manifests = await listRichSkillManifestsAsync(args.userId, workspace.id);
    const route = routeSkills(manifests, {
      task: args.task,
      userMessage: args.task,
      activeWorkspaceId: workspace.id,
      availableConnections: connIds,
      availableTools: TOOL_CATALOG.map((tool) => tool.name),
      enabledSkillIds: workspace.enabledSkillIds.length ? workspace.enabledSkillIds : [],
      currentSurface: 'unknown',
    });
    const skillsBlock = renderSkillRoutePrompt(route);
    if (skillsBlock) sections.push(skillsBlock);

    // Workflow template steps + verification, when one was selected.
    let workflowTemplateId: string | undefined;
    if (args.workflowTemplateId) {
      const template = await getWorkflowTemplate(args.workflowTemplateId, args.userId);
      if (template) {
        sections.push(renderWorkflowPrompt(template));
        workflowTemplateId = template.id;
      }
    }

    return {
      workspace,
      workspaceRoot: primaryLocalRoot(workspace),
      promptBlock: sections.join('\n\n'),
      usedMemoryIds: scored.map((s) => s.entry.id),
      roleId: role?.id,
      workflowTemplateId,
      skillRoute: route,
    };
  } catch (err) {
    console.warn('Coworker prompt context unavailable:', err);
    return { promptBlock: '', usedMemoryIds: [] };
  }
}

/** Mark surfaced memory as used (recency boost). Fire-and-forget safe. */
export async function recordMemoryUsage(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => markMemoryUsed(id).catch(() => undefined)));
}

// ── Task / evidence tracking ────────────────────────────────────────────────

export interface TaskTracker {
  readonly taskRunId?: string;
  recordStep(step: StepLike): Promise<void>;
  setStatus(status: TaskStatus, extra?: { error?: string; summary?: string }): Promise<void>;
}

const NOOP_TRACKER: TaskTracker = {
  taskRunId: undefined,
  async recordStep() {},
  async setStatus() {},
};

/**
 * Create a TaskRun and return a tracker that persists evidence + output refs as
 * steps stream in. If creation fails, returns a no-op tracker so the loop is
 * unaffected.
 */
export async function startTaskTracker(args: {
  userId: string;
  workspaceId?: string;
  sessionId: string;
  task: string;
  modelId: string;
  autonomyMode: AutonomyMode;
  roleId?: string;
  workflowTemplateId?: string;
}): Promise<TaskTracker> {
  let run: TaskRun;
  try {
    run = await createTaskRun({
      userId: args.userId,
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      title: deriveTitle(args.task),
      originalPrompt: args.task,
      modelId: args.modelId,
      autonomyMode: args.autonomyMode,
      metadata: args.roleId || args.workflowTemplateId
        ? { roleId: args.roleId, templateId: args.workflowTemplateId }
        : undefined,
    });
  } catch (err) {
    console.warn('Task tracking disabled (createTaskRun failed):', err);
    return NOOP_TRACKER;
  }

  return {
    taskRunId: run.id,
    async recordStep(step: StepLike) {
      try {
        const ev = stepToEvidence(step, { taskRunId: run.id, userId: args.userId, workspaceId: args.workspaceId });
        if (ev) await addEvidence(ev);
        const ref = stepToOutputRef(step);
        if (ref) await addOutputRef(run.id, ref);
      } catch {
        /* evidence is best-effort */
      }
    },
    async setStatus(status, extra) {
      try {
        await setTaskStatus(run.id, status, extra);
      } catch {
        /* best-effort */
      }
    },
  };
}

function deriveTitle(task: string): string {
  const firstLine = task.split('\n')[0]?.trim() ?? task;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || 'Task';
}
