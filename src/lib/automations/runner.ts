import { createNotification } from '../notifications/store';
import { enqueueTask } from '../queue/store';
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
    const prompt = renderAutomationPrompt(automation.name, automation.taskTemplate.prompt, triggerPayload);
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
        skillIds: automation.taskTemplate.skillIds,
        workflowTemplateId: automation.taskTemplate.workflowTemplateId,
        roleTemplateId: automation.taskTemplate.roleTemplateId,
        requiredConnectionIds: automation.taskTemplate.requiredConnectionIds,
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

function renderAutomationPrompt(name: string, prompt: string, payload: Record<string, unknown>): string {
  const payloadText = Object.keys(payload).length
    ? `\n\nAutomation trigger payload:\n${JSON.stringify(payload, null, 2)}`
    : '';
  return `Automation: ${name}\n\n${prompt}${payloadText}`;
}
