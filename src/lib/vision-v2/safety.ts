// Vision Mouse V2 — safety gate.
//
// Before the executor performs an action, classify whether it is risky
// (irreversible / sends data / spends money / touches credentials). Risky
// actions must NOT be auto-executed — the orchestrator turns them into an
// ask_user / confirm_action and only proceeds on explicit approval.
//
// This is a pre-check on the planner's chosen action + target text, independent
// of the model's own judgement, so a confident-but-wrong plan can't, say, click
// "Delete account" without a human.

import type { ActionPlan } from './types';

export type RiskLevel = 'low' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  reason?: string;
  /** Matched category, for logging. */
  category?: string;
}

// Keyword groups (lowercased, EN + HU). Matched against the action's target
// text / typed text / summary.
const RISK_TERMS: Record<string, string[]> = {
  delete: ['delete', 'remove', 'töröl', 'eltávolít', 'discard', 'erase', 'format', 'uninstall', 'drop table', 'factory reset'],
  payment: ['pay', 'purchase', 'buy', 'checkout', 'order now', 'subscribe', 'fizet', 'vásárol', 'rendel', 'place order', 'confirm payment'],
  send: ['send', 'submit', 'publish', 'post', 'küld', 'elküld', 'beküld', 'közzé', 'send email', 'send message', 'transfer', 'utal'],
  credentials: ['password', 'jelszó', 'card number', 'cvv', 'kártyaszám', 'ssn', 'social security', 'private key', 'seed phrase'],
  system: ['shutdown', 'restart', 'reboot', 'leállít', 'újraindít', 'registry', 'disable firewall', 'system restore'],
  // Destructive / outward-facing shell commands (cli_command).
  shell: ['rm -rf', 'rm -r', 'rmdir', 'rd /s', 'del /', 'del /q', 'format ', 'mkfs', 'dd if=',
    'git push --force', 'git push -f', 'reset --hard', 'git clean -', 'npm publish', 'cargo publish',
    '> /dev/', 'shutdown', 'taskkill /f', 'reg delete', 'remove-item', 'rd /q'],
};

// Actions that never carry risk on their own.
const SAFE_ACTIONS: ReadonlySet<ActionPlan['action']> = new Set([
  'wait', 'done', 'ask_user', 'scroll',
]);

function textOf(plan: ActionPlan): string {
  return [plan.target?.text, plan.text, plan.command, plan.summary, plan.reason]
    .filter(Boolean).join(' ').toLowerCase();
}

/**
 * Assess a plan. Returns high risk + the category when the action both *commits*
 * something (click/hotkey/type/raw) and its text matches a risky term.
 */
export function classifyRisk(plan: ActionPlan): RiskAssessment {
  if (SAFE_ACTIONS.has(plan.action)) return { level: 'low' };
  const hay = textOf(plan);
  if (!hay) return { level: 'low' };
  for (const [category, terms] of Object.entries(RISK_TERMS)) {
    const hit = terms.find((t) => hay.includes(t));
    if (hit) {
      return {
        level: 'high',
        category,
        reason: `Action "${plan.action}" matches a ${category} risk term ("${hit}") and could be irreversible or send data.`,
      };
    }
  }
  return { level: 'low' };
}
