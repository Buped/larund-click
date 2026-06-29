import { enqueueTask } from '../queue/store';
import type { EvidenceEntry } from '../tasks/types';
import { resolveReferencedContext } from '../mentions/resolve';
import { defaultSafetyPolicy, normalizeAutomation, type NormalizedAutomation } from './migrate';
import { createAutomationRun, getAutomation, updateAutomation, updateAutomationRun } from './store';
import type {
  Automation,
  AutomationRunStatus,
  AutomationSetupBinding,
  AutomationSetupBindingKind,
  AutomationSetupBindingSpec,
  AutomationSetupPlan,
} from './types';

export function isAutomationSetupReady(automation: Automation | NormalizedAutomation): boolean {
  const setup = normalizeAutomation(automation).setupPlan;
  return setup.status === 'not_required' || setup.status === 'ready';
}

export function setupRequired(setup: AutomationSetupPlan): boolean {
  return setup.status !== 'not_required' || setup.steps.length > 0 || setup.bindingSpecs.length > 0;
}

export function renderProvisionedBindingsBlock(setup: AutomationSetupPlan): string {
  if (!setup?.bindings?.length) return '';
  const lines = ['Provisioned infrastructure:'];
  for (const binding of setup.bindings) {
    const target = binding.url ?? binding.path ?? binding.refId ?? '';
    lines.push(`- ${binding.key} (${binding.kind}) ${binding.label}${target ? ` -> ${target}` : ''}`);
  }
  return lines.join('\n');
}

export function renderAutomationSetupPrompt(a: NormalizedAutomation, resolvedContext = ''): string {
  const lines: string[] = [
    `Automation setup: ${a.name}`,
    '',
    a.description ? `Description: ${a.description}` : '',
    '',
    'This is a one-time setup run. Create or validate durable infrastructure that later automation runs will reuse.',
    'Rules:',
    '- Be idempotent: search/validate an existing matching resource first, and create only when none exists.',
    '- Use deterministic names like "Larund - <automation name> - <binding key>".',
    '- Do not send, publish, submit, delete, overwrite unrelated data, or perform destructive work during setup.',
    '- For every created or validated resource, read it back and include its URL/id/path clearly in the result.',
    '- Complete only after all required setup verification checks pass.',
  ].filter(Boolean);

  if (a.referencedContext.length) {
    lines.push('', 'Global referenced context:');
    for (const ref of a.referencedContext) {
      const doc = ref.metadata?.documentReference as { kind?: string; path?: string; url?: string } | undefined;
      const target = doc?.path ?? doc?.url ?? ref.refId;
      lines.push(`- [${doc?.kind ?? ref.kind}] ${ref.label}${target && target !== ref.label ? ` -> ${target}` : ''}`);
    }
  }

  if (resolvedContext) lines.push('', resolvedContext);

  if (a.setupPlan.bindingSpecs.length) {
    lines.push('', 'Required setup bindings to produce:');
    for (const spec of a.setupPlan.bindingSpecs) {
      lines.push(`- ${spec.key} (${spec.kind}) ${spec.label}${spec.description ? `: ${spec.description}` : ''}`);
    }
  }

  if (a.setupPlan.steps.length) {
    lines.push('', 'Setup steps:');
    for (const step of [...a.setupPlan.steps].sort((x, y) => x.order - y.order)) {
      lines.push(`${step.order + 1}. ${step.title}: ${step.instruction}${step.verificationHint ? ` [verify: ${step.verificationHint}]` : ''}`);
    }
  }

  if (a.setupPlan.verificationChecklist.length) {
    lines.push('', 'Setup verification - ALL required checks must pass:');
    for (const check of a.setupPlan.verificationChecklist) {
      lines.push(`- [${check.required ? 'required' : 'optional'}] ${check.title} (${check.kind})`);
    }
  }

  return lines.join('\n');
}

export async function prepareAutomation(
  automationId: string,
  opts: { reason?: string } = {},
): Promise<{ status: AutomationSetupPlan['status']; automationRunId?: string; queueItemId?: string }> {
  const processor = await import('./agent-processor');
  processor.ensureAutomationQueueProcessor();
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error(`Automation not found: ${automationId}`);
  const norm = normalizeAutomation(automation);
  if (!setupRequired(norm.setupPlan)) return { status: 'not_required' };
  if (norm.setupPlan.status === 'ready') return { status: 'ready', automationRunId: norm.setupPlan.lastRunId };
  if (norm.setupPlan.status === 'running' || norm.setupPlan.status === 'waiting_approval' || norm.setupPlan.status === 'waiting_user') {
    return { status: norm.setupPlan.status, automationRunId: norm.setupPlan.lastRunId };
  }

  const allReferences = [
    ...norm.referencedContext,
    ...norm.setupPlan.steps.flatMap((step) => step.referencedContext),
  ];
  const resolved = await resolveReferencedContext({
    references: allReferences,
    userId: automation.userId,
    workspaceId: automation.workspaceId,
  });
  if (resolved.blockers.length) {
    throw new Error(`Setup context is not ready:\n${resolved.blockers.map((b) => `- ${b}`).join('\n')}`);
  }

  const run = await createAutomationRun({
    automationId,
    status: 'queued',
    triggerPayload: { reason: opts.reason ?? 'setup', automationPhase: 'setup' },
  });
  const setupPrompt = renderAutomationSetupPrompt(norm, resolved.promptBlock);
  const queueItem = await enqueueTask({
    userId: automation.userId,
    workspaceId: automation.workspaceId,
    source: 'automation',
    prompt: setupPrompt,
    priority: 'normal',
    metadata: {
      automationId: automation.id,
      automationRunId: run.id,
      automationPhase: 'setup',
      autonomyMode: automation.autonomyMode,
      approvalPolicy: automation.approvalPolicy,
      requiredConnectionIds: automation.taskTemplate.requiredConnectionIds ?? [],
      skillIds: automation.taskTemplate.skillIds ?? [],
      referencedContext: allReferences,
      steps: norm.setupPlan.steps,
      verificationChecklist: norm.setupPlan.verificationChecklist,
      safetyPolicy: {
        ...defaultSafetyPolicy('semi'),
        ...norm.safetyPolicy,
        externalWrite: 'allow',
        externalSend: 'ask',
        destructive: 'ask_strong',
      },
    },
  });

  await updateAutomationRun(run.id, { status: 'running', queueItemId: queueItem.id });
  await updateAutomation(automationId, {
    setupPlan: {
      ...norm.setupPlan,
      status: 'running',
      lastRunId: run.id,
      taskRunId: undefined,
      error: undefined,
    },
  });
  return { status: 'running', automationRunId: run.id, queueItemId: queueItem.id };
}

export async function markAutomationSetupStatus(
  automationId: string,
  status: AutomationRunStatus,
  extra: { taskRunId?: string; error?: string } = {},
): Promise<void> {
  const automation = await getAutomation(automationId);
  if (!automation) return;
  const norm = normalizeAutomation(automation);
  const setupStatus = status === 'waiting_approval' || status === 'waiting_user'
    ? status
    : status === 'cancelled'
      ? 'cancelled'
      : status === 'failed'
        ? 'failed'
        : norm.setupPlan.status;
  await updateAutomation(automationId, {
    setupPlan: {
      ...norm.setupPlan,
      status: setupStatus,
      taskRunId: extra.taskRunId ?? norm.setupPlan.taskRunId,
      error: extra.error,
    },
  });
}

export async function completeAutomationSetup(
  automationId: string,
  evidence: EvidenceEntry[],
  taskRunId?: string,
): Promise<AutomationSetupBinding[]> {
  const automation = await getAutomation(automationId);
  if (!automation) return [];
  const norm = normalizeAutomation(automation);
  const bindings = extractSetupBindingsFromEvidence(evidence, norm.setupPlan.bindingSpecs);
  const missing = norm.setupPlan.bindingSpecs.filter((spec) => spec.required !== false && !bindings.some((binding) => binding.key === spec.key));
  if (missing.length) {
    const message = `Setup did not produce required binding(s): ${missing.map((spec) => spec.label || spec.key).join(', ')}`;
    await updateAutomation(automationId, {
      setupPlan: {
        ...norm.setupPlan,
        status: 'failed',
        taskRunId,
        error: message,
      },
    });
    throw new Error(message);
  }
  await updateAutomation(automationId, {
    setupPlan: {
      ...norm.setupPlan,
      status: 'ready',
      bindings,
      taskRunId,
      error: undefined,
      completedAt: new Date().toISOString(),
    },
  });
  return bindings;
}

export function extractSetupBindingsFromEvidence(
  evidence: EvidenceEntry[],
  specs: AutomationSetupBindingSpec[],
): AutomationSetupBinding[] {
  const text = evidence.map((entry) => `${entry.tool ?? ''}\n${entry.artifactUri ?? ''}\n${entry.content}`).join('\n');
  const used = new Set<string>();
  return specs.flatMap((spec) => {
    const candidate = findBindingTarget(text, spec.kind, used);
    if (!candidate) return [];
    used.add(candidate);
    return [{ ...spec, ...targetToBinding(candidate), verifiedAt: new Date().toISOString() }];
  });
}

function findBindingTarget(text: string, kind: AutomationSetupBindingKind, used: Set<string>): string | undefined {
  const patterns: RegExp[] = kind === 'google_sheet'
    ? [/https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+[^\s"')>]*/g, /\bspreadsheetId["':\s]+([A-Za-z0-9_-]+)/g]
    : kind === 'google_doc'
      ? [/https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+[^\s"')>]*/g, /\bdocumentId["':\s]+([A-Za-z0-9_-]+)/g]
      : kind === 'drive_folder'
        ? [/https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+[^\s"')>]*/g, /\bfolderId["':\s]+([A-Za-z0-9_-]+)/g]
        : kind === 'local_folder' || kind === 'local_file'
          ? [/[A-Za-z]:[\\/][^\r\n"']+/g, /\/[^\r\n"']+/g]
          : [/https?:\/\/[^\s"')>]+/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).trim().replace(/[),.;]+$/, '');
      if (value && !used.has(value)) return value;
    }
  }
  return undefined;
}

function targetToBinding(target: string): Pick<AutomationSetupBinding, 'url' | 'path' | 'refId'> {
  if (/^https?:\/\//i.test(target)) return { url: target };
  if (/[\\/]/.test(target)) return { path: target };
  return { refId: target };
}
