import { createNotification } from '../notifications/store';
import { enqueueTask } from '../queue/store';
import { normalizeAutomation, referencedConnectionIds, referencedSkillIds, referencedMcpIds, type NormalizedAutomation } from './migrate';
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
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error(`Automation not found: ${automationId}`);
  if (!automation.enabled || automation.status === 'paused' || automation.status === 'disabled') {
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
    const prompt = renderAutomationPrompt(norm, triggerPayload);
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
        referencedContext: norm.referencedContext,
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
function renderAutomationPrompt(a: NormalizedAutomation, payload: Record<string, unknown>): string {
  const lines: string[] = [`Automation: ${a.name}`, '', a.prompt || a.taskTemplate.prompt];

  if (a.referencedContext.length) {
    lines.push('', 'Referenced context:');
    for (const r of a.referencedContext) {
      const meta = r.kind === 'memory' && typeof r.metadata?.content === 'string' ? ` — ${r.metadata.content}` : '';
      lines.push(`- [${r.kind}] ${r.label}${meta}`);
    }
  }

  if (a.steps.length) {
    lines.push('', 'Follow these steps in order (do not skip required steps):');
    for (const s of [...a.steps].sort((x, y) => x.order - y.order)) {
      lines.push(`${s.order + 1}. ${s.title}${s.required ? '' : ' (optional)'}: ${s.instruction}${s.verificationHint ? ` [verify: ${s.verificationHint}]` : ''}`);
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
