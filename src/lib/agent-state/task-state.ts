// Creates and mutates the ActiveTaskState, and renders it into the prompt block
// the model sees every turn. This is what makes the operator *persistent*.

import type { TaskPreflight } from '../control-system/preflight';
import { deriveExpectedArtifacts, deriveTargetDocument, derivePendingChecks, deriveSuccessCriteria } from './goal-state';
import type { ActiveTaskState, FailedAttempt, TaskSurface } from './types';

function genId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTaskState(goal: string, pf: TaskPreflight): ActiveTaskState {
  const now = Date.now();
  return {
    id: genId(),
    originalUserGoal: goal,
    currentGoal: goal,
    status: 'planning',
    intent: pf.intent,
    targetApp: pf.targetApp,
    targetSurface: (pf.targetSurface as TaskSurface) ?? undefined,
    targetUrl: pf.targetUrl,
    targetDocument: deriveTargetDocument(pf),
    expectedOutcome: pf.expectedOutcome,
    expectedArtifacts: deriveExpectedArtifacts(pf),
    requiresAuth: pf.requiresAuth,
    failedAttempts: [],
    userCorrections: [],
    completedChecks: [],
    pendingChecks: derivePendingChecks(pf),
    successCriteria: deriveSuccessCriteria(pf),
    forbiddenStrategies: [...pf.forbiddenTools.map((t) => `Do not rely on ${t} to satisfy this task.`)],
    createdAt: now,
    updatedAt: now,
  };
}

export function recordFailedAttempt(state: ActiveTaskState, attempt: FailedAttempt): void {
  state.failedAttempts.push(attempt);
  state.updatedAt = Date.now();
}

export function forbidStrategy(state: ActiveTaskState, strategy: string): void {
  if (!state.forbiddenStrategies.includes(strategy)) {
    state.forbiddenStrategies.push(strategy);
    state.updatedAt = Date.now();
  }
}

/**
 * Fold a user correction into the active task instead of starting over. Records
 * the correction, the (presumed) failed strategy, and forbids repeating it.
 */
export function applyCorrection(
  state: ActiveTaskState,
  message: string,
  interpretation: string,
  signals: string[],
): void {
  state.userCorrections.push({ message, interpretation, timestamp: Date.now() });
  state.currentGoal = `${state.originalUserGoal} — correction: ${message}`;
  state.status = 'running';

  if (signals.includes('forbid_local') || state.intent === 'spreadsheet_cloud') {
    forbidStrategy(state, 'Creating only a local CSV/XLSX file (the user wants the cloud/web target).');
    recordFailedAttempt(state, {
      step: 'previous completion',
      reason: 'Previous completion was wrong — the requested target was not actually populated.',
      evidence: message,
    });
  }
  if (signals.includes('empty') || signals.includes('not_uploaded')) {
    recordFailedAttempt(state, {
      step: 'data write',
      reason: 'Target reported empty by the user; data was never actually written.',
      evidence: message,
    });
  }
  state.updatedAt = Date.now();
}

/** Render the active task as a prompt block. Kept terse to save tokens. */
export function renderTaskStatePrompt(state: ActiveTaskState): string {
  const lines: string[] = ['## Active Task State'];
  lines.push(`Original goal: ${state.originalUserGoal}`);
  if (state.currentGoal !== state.originalUserGoal) lines.push(`Current goal: ${state.currentGoal}`);
  lines.push(`Status: ${state.status}`);
  if (state.intent) lines.push(`Intent: ${state.intent}`);
  if (state.targetSurface) lines.push(`Target surface: ${state.targetSurface}`);
  if (state.targetDocument) {
    const d = state.targetDocument;
    lines.push(`Target document: ${d.type}${d.url ? ` (${d.url})` : ''}${d.localPath ? ` (${d.localPath})` : ''}`);
  }
  if (state.targetUrl && !state.targetDocument?.url) lines.push(`Target URL: ${state.targetUrl}`);
  if (state.expectedOutcome) lines.push(`Expected outcome: ${state.expectedOutcome}`);
  if (state.referencedInputs?.length) {
    lines.push('Referenced inputs:');
    for (const ref of state.referencedInputs) {
      lines.push(`  - ${ref.id}: ${ref.kind} "${ref.label}" ${ref.path ?? ref.url ?? ''}`.trimEnd());
    }
    lines.push('Rule: inspect/read these references before using their contents. Do not invent contents.');
  }
  if (state.filesRead?.length) {
    lines.push(`Files read: ${state.filesRead.join('; ')}`);
  }
  if (state.lastKnownState) lines.push(`Last known state: ${state.lastKnownState}`);
  if (state.userCorrections.length) {
    const last = state.userCorrections[state.userCorrections.length - 1];
    lines.push(`User correction: "${last.message}" → ${last.interpretation}`);
  }
  if (state.failedAttempts.length) {
    lines.push('Failed attempts (do not repeat):');
    for (const f of state.failedAttempts.slice(-4)) {
      lines.push(`  - ${f.step}: ${f.reason}`);
    }
  }
  if (state.forbiddenStrategies.length) {
    lines.push('Do not:');
    for (const s of state.forbiddenStrategies) lines.push(`  - ${s}`);
  }
  if (state.pendingChecks.length) {
    lines.push(`Pending verification: ${state.pendingChecks.join('; ')}`);
  }
  const visualCriteria = (state.successCriteria ?? []).filter((c) => c.method === 'visual' || c.method === 'both');
  if (visualCriteria.length) {
    lines.push('Visual success criteria (confirm with screen.verify before task.complete):');
    for (const c of visualCriteria) lines.push(`  - [${c.status}] ${c.text}`);
  }
  if (state.lastVisualVerdict) {
    const v = state.lastVisualVerdict;
    lines.push(
      `Last visual check: done=${v.done}, progress=${v.progress}%` +
        (v.unmetCriteria.length ? `, still unmet: ${v.unmetCriteria.join('; ')}` : '') +
        (v.blockers.length ? `, blockers: ${v.blockers.join('; ')}` : ''),
    );
  }
  return lines.join('\n');
}
