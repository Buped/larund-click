import { createNotification } from '../notifications/store';
import { enqueueTask } from '../queue/store';
import { ensureAutomationQueueProcessor } from './agent-processor';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, referencedMcpIds, type NormalizedAutomation } from './migrate';
import { resolveReferencedContext } from '../mentions/resolve';
import {
  createAutomationRun,
  getAutomation,
  recordAutomationRunResult,
  updateAutomationRun,
} from './store';

export async function runAutomation(
  automationId: string,
  triggerPayload: Record<string, unknown> = {},
): Promise<{ automationRunId: string; queueItemId?: string }> {
  ensureAutomationQueueProcessor();
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error(`Automation not found: ${automationId}`);
  const reason = typeof triggerPayload.reason === 'string' ? triggerPayload.reason : '';
  const explicitUserRun = reason === 'manual_run' || reason === 'test_run';
  if ((!automation.enabled || automation.status === 'paused' || automation.status === 'disabled') && !explicitUserRun) {
    const skipped = await createAutomationRun({
      automationId,
      status: 'skipped',
      triggerPayload: { ...triggerPayload, reason: 'automation_disabled' },
    });
    return { automationRunId: skipped.id };
  }

  const run = await createAutomationRun({ automationId, status: 'queued', triggerPayload });
  try {
    const norm = normalizeAutomation(automation);
    const allReferences = [
      ...norm.referencedContext,
      ...norm.steps.flatMap((s) => s.referencedContext),
    ];
    const resolved = await resolveReferencedContext({
      references: allReferences,
      userId: automation.userId,
      workspaceId: automation.workspaceId,
    });
    if (resolved.blockers.length) throw new Error(`Referenced context is not ready:\n${resolved.blockers.map((b) => `- ${b}`).join('\n')}`);
    const prompt = renderAutomationPrompt(norm, triggerPayload, resolved.promptBlock);
    const queueItem = await enqueueTask({
      userId: automation.userId,
      workspaceId: automation.workspaceId,
      source: 'automation',
      prompt,
      priority: 'normal',
      metadata: {
        automationId: automation.id,
        automationRunId: run.id,
        autonomyMode: automation.autonomyMode,
        approvalPolicy: automation.approvalPolicy,
        // Reference connections from both legacy template and new mention chips.
        skillIds: referencedSkillIds(norm),
        workflowTemplateId: automation.taskTemplate.workflowTemplateId,
        roleTemplateId: automation.taskTemplate.roleTemplateId,
        requiredConnectionIds: referencedConnectionIds(norm),
        mcpServerIds: referencedMcpIds(norm),
        referencedContext: allReferences,
        steps: norm.steps,
        verificationChecklist: norm.verificationChecklist,
        safetyPolicy: norm.safetyPolicy,
      },
    });
    await updateAutomationRun(run.id, { status: 'running', queueItemId: queueItem.id });
    await recordAutomationRunResult(automation.id, 'running', { queueItemId: queueItem.id });
    return { automationRunId: run.id, queueItemId: queueItem.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAutomationRun(run.id, { status: 'failed', error: message });
    await recordAutomationRunResult(automation.id, 'failed', { error: message });
    await createNotification({
      userId: automation.userId,
      workspaceId: automation.workspaceId,
      kind: 'automation_failed',
      title: `Automation failed: ${automation.name}`,
      body: message,
      metadata: { automationId: automation.id, automationRunId: run.id },
    });
    throw err;
  }
}

/**
 * Builds the agent prompt from the full workflow definition: goal, referenced
 * context, ordered steps, verification checklist and safety policy. The agent
 * receives the plan and must not complete without satisfying verification.
 */
export function renderAutomationPrompt(a: NormalizedAutomation, payload: Record<string, unknown>, resolvedContext = ''): string {
  const lines: string[] = [`Automation: ${a.name}`, '', a.prompt || a.taskTemplate.prompt];
  if (a.description) lines.splice(1, 0, `Description: ${a.description}`);

  if (a.referencedContext.length) {
    lines.push('', 'Global referenced context:');
    for (const r of a.referencedContext) {
      lines.push(formatReferenceLine(r));
    }
  }

  if (resolvedContext) lines.push('', resolvedContext);

  const triggerContext = renderTriggerContext(payload);
  if (triggerContext.length) {
    lines.push('', 'Current trigger input:');
    lines.push(...triggerContext);
    lines.push('- Use the trigger file as the primary input unless a step explicitly says otherwise.');
  }

  if (a.steps.length) {
    lines.push('', 'Step execution contract:', '- Execute the current step before moving to the next step.', '- Do not skip required steps. If a required step is blocked, use ask_user or report the blocker instead of silently continuing.', '- Before task.complete, every required step must have supporting evidence from tool calls/results.');
    lines.push('', 'Follow these steps in order (do not skip required steps):');
    for (const s of [...a.steps].sort((x, y) => x.order - y.order)) {
      lines.push(`${s.order + 1}. ${s.title}${s.required ? '' : ' (optional)'}: ${s.instruction}${s.verificationHint ? ` [verify: ${s.verificationHint}]` : ''}`);
      if (s.referencedContext.length) {
        lines.push('   Context for this step:');
        for (const r of s.referencedContext) lines.push(`   ${formatReferenceLine(r)}`);
      }
    }
  }

  if (a.verificationChecklist.length) {
    lines.push('', 'Verification — ALL required checks must pass before task.complete:');
    for (const v of a.verificationChecklist) lines.push(`- [${v.required ? 'required' : 'optional'}] ${v.title} (${v.kind})`);
  }

  lines.push('', `Safety: autonomy=${a.safetyPolicy.autonomyMode}, external_write=${a.safetyPolicy.externalWrite}, external_send=${a.safetyPolicy.externalSend}, destructive=${a.safetyPolicy.destructive}. Never use a mouse; act through tools, files, browser DOM/CDP, connections and MCP only.`);

  if (Object.keys(payload).length) lines.push('', `Automation trigger payload:\n${JSON.stringify(payload, null, 2)}`);
  return lines.join('\n');
}

function formatReferenceLine(ref: NormalizedAutomation['referencedContext'][number]): string {
  const doc = ref.metadata?.documentReference as { kind?: string; path?: string; url?: string } | undefined;
  const target = doc?.path ?? doc?.url ?? ref.refId;
  const parts = [`- [${doc?.kind ?? ref.kind}] ${ref.label}`];
  if (target && target !== ref.label) parts.push(`-> ${target}`);
  if (ref.kind === 'memory' && typeof ref.metadata?.content === 'string') parts.push(`- ${ref.metadata.content}`);
  if (typeof ref.metadata?.detail === 'string') parts.push(`- ${ref.metadata.detail}`);
  return parts.join(' ');
}

function renderTriggerContext(payload: Record<string, unknown>): string[] {
  if (payload.kind !== 'folder_watch' && !payload.filePath && !payload.watchedPath) return [];
  return [
    payload.eventType ? `- event: ${String(payload.eventType)}` : undefined,
    payload.fileName ? `- file name: ${String(payload.fileName)}` : undefined,
    payload.filePath ? `- file path: ${String(payload.filePath)}` : undefined,
    payload.folderPath || payload.watchedPath ? `- watched folder: ${String(payload.folderPath ?? payload.watchedPath)}` : undefined,
    payload.detectedAt ? `- detected at: ${String(payload.detectedAt)}` : undefined,
    payload.pattern ? `- matching pattern: ${String(payload.pattern)}` : undefined,
  ].filter((line): line is string => Boolean(line));
}
