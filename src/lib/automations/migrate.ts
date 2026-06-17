// Normalizes automations so the workflow-builder UI can rely on the new fields
// being present, while old saved automations (which only have taskTemplate +
// autonomyMode + approvalPolicy) keep working. Pure + idempotent.

import type {
  Automation, AutomationSafetyPolicy, AutomationStep, ReferencedContext, VerificationCheck,
} from './types';

export interface NormalizedAutomation extends Automation {
  prompt: string;
  referencedContext: ReferencedContext[];
  steps: AutomationStep[];
  verificationChecklist: VerificationCheck[];
  safetyPolicy: AutomationSafetyPolicy;
}

export function defaultSafetyPolicy(autonomyMode: Automation['autonomyMode'], approval?: Automation['approvalPolicy']): AutomationSafetyPolicy {
  return {
    autonomyMode: autonomyMode === 'manual' ? 'manual' : autonomyMode === 'full' ? 'semi' : 'safe_reads',
    externalWrite: 'ask',
    externalSend: approval?.externalSendRequiresApproval === false ? 'ask' : 'ask',
    destructive: approval?.destructiveRequiresApproval === false ? 'ask_strong' : 'ask_strong',
    processExec: 'ask',
  };
}

export function defaultVerification(): VerificationCheck[] {
  return [
    { id: 'v-readback', title: 'Output was read back', description: 'Larund re-reads its produced output before completing.', kind: 'file_read_back', required: true },
  ];
}

/** Fill in the workflow-builder fields from legacy data when absent. */
export function normalizeAutomation(a: Automation): NormalizedAutomation {
  return {
    ...a,
    prompt: a.prompt ?? a.taskTemplate?.prompt ?? '',
    referencedContext: a.referencedContext ?? [],
    steps: a.steps ?? [],
    verificationChecklist: a.verificationChecklist ?? defaultVerification(),
    safetyPolicy: a.safetyPolicy ?? defaultSafetyPolicy(a.autonomyMode, a.approvalPolicy),
  };
}

/** Connection refIds referenced anywhere in the automation (prompt mentions + steps + taskTemplate). */
export function referencedConnectionIds(a: NormalizedAutomation): string[] {
  const ids = new Set<string>(a.taskTemplate?.requiredConnectionIds ?? []);
  for (const r of a.referencedContext) if (r.kind === 'connection') ids.add(r.refId);
  for (const s of a.steps) for (const r of s.referencedContext) if (r.kind === 'connection') ids.add(r.refId);
  return [...ids];
}

export function referencedSkillIds(a: NormalizedAutomation): string[] {
  const ids = new Set<string>(a.taskTemplate?.skillIds ?? []);
  for (const r of a.referencedContext) if (r.kind === 'skill') ids.add(r.refId);
  for (const s of a.steps) for (const r of s.referencedContext) if (r.kind === 'skill') ids.add(r.refId);
  return [...ids];
}

export function referencedMcpIds(a: NormalizedAutomation): string[] {
  const ids = new Set<string>();
  for (const r of a.referencedContext) if (r.kind === 'mcp') ids.add(r.refId);
  for (const s of a.steps) for (const r of s.referencedContext) if (r.kind === 'mcp') ids.add(r.refId);
  return [...ids];
}
