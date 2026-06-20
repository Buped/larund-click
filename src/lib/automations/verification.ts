import type { EvidenceEntry } from '../tasks/types';
import type { AutomationSafetyPolicy, VerificationCheck } from './types';
import { policyForAutonomyMode, type RiskPolicy } from '../tools/policy';

export interface AutomationVerificationResult {
  ok: boolean;
  reason: string;
  missing: VerificationCheck[];
}

export function riskPolicyForAutomationSafety(policy: AutomationSafetyPolicy): RiskPolicy {
  const base = policy.autonomyMode === 'manual'
    ? policyForAutonomyMode('manual')
    : policy.autonomyMode === 'semi'
      ? policyForAutonomyMode('semi')
      : policyForAutonomyMode('semi');

  return {
    ...base,
    external_write: mapDecision(policy.externalWrite),
    external_send: mapDecision(policy.externalSend),
    destructive: policy.destructive === 'block' ? 'block' : 'ask',
    process_exec: policy.processExec === 'block' ? 'block' : 'ask',
  };
}

export function verifyAutomationEvidence(
  checklist: VerificationCheck[] | undefined,
  evidence: EvidenceEntry[],
): AutomationVerificationResult {
  const required = (checklist ?? []).filter((check) => check.required);
  const missing = required.filter((check) => !checkPassed(check, evidence));
  if (!missing.length) {
    return { ok: true, reason: required.length ? 'Required automation checks have supporting evidence.' : 'No required automation checks.', missing: [] };
  }
  return {
    ok: false,
    reason: `Missing verification evidence for: ${missing.map((check) => check.title).join(', ')}`,
    missing,
  };
}

function mapDecision(value: 'ask' | 'allow' | 'block'): 'auto' | 'ask' | 'block' {
  if (value === 'allow') return 'auto';
  if (value === 'block') return 'block';
  return 'ask';
}

function checkPassed(check: VerificationCheck, evidence: EvidenceEntry[]): boolean {
  if (check.kind === 'manual_review') return false;
  if (check.kind === 'contains_text') {
    const expected = textConfig(check);
    if (!expected) return evidence.some((ev) => ev.success !== false && Boolean(ev.content.trim()));
    return evidence.some((ev) => ev.success !== false && ev.content.toLowerCase().includes(expected.toLowerCase()));
  }
  if (check.kind === 'file_exists') {
    return evidence.some((ev) => ev.success !== false && ev.tool === 'file.exists');
  }
  if (check.kind === 'file_read_back') {
    return evidence.some((ev) => ev.success !== false && (ev.kind === 'read_back' || /file\.read|document\.read|folder\.read/i.test(ev.tool ?? '')));
  }
  if (check.kind === 'doc_read_back') {
    return evidence.some((ev) => ev.success !== false && /doc\.read|document\.read/i.test(ev.tool ?? ''));
  }
  if (check.kind === 'sheet_values_match') {
    return evidence.some((ev) => ev.success !== false && (/sheet\.read|connection\.call/i.test(ev.tool ?? '') || ev.kind === 'read_back'));
  }
  if (check.kind === 'connection_read_back') {
    return evidence.some((ev) => ev.success !== false && (ev.kind === 'connection_output' || ev.tool === 'connection.call'));
  }
  return evidence.some((ev) => ev.success !== false && ev.kind === 'verification');
}

function textConfig(check: VerificationCheck): string | null {
  const cfg = check.config ?? {};
  const value = cfg.text ?? cfg.contains ?? cfg.expectedText;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
