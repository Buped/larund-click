import { emit } from '@tauri-apps/api/event';
import { callOpenRouterWithTools, type MessageContent } from '../openrouter';
import { CONTROL_SYSTEM_PROMPT, autonomyModePrompt } from './prompt';
import { parseControlAction, isLegacyVisualActionName } from './parser';
import { extractNarration, isMeaningfulNarration, sanitizeUserVisibleNarration } from '../assistant/narration';
import type { ControlAction } from './types';
import { runControlAction } from '../tools/run';
import { MemoryAuditLogger } from '../tools/audit';
import { PromptApprovalService, type ApprovalPromptResult } from '../tools/approvals';
import { policyForAutonomyMode, type RiskPolicy } from '../tools/policy';
import { toolCatalogSummary } from '../tools/registry';
import type { AuditEntry, ConnectionRegistry, SkillRunner, WorkflowRunner } from '../tools/types';
import { createConnectionRegistry } from '../connections/registry';
import { createSkillRunner } from '../skills/runner';
import { learnFromCompletedTask } from '../skills/learning';
import { detectSkillGap } from '../skills/skill-gap';
import { researchSkillGap, synthesizeSelfLearnedSkill, type SkillResearchSummary } from '../skills/self-learning';
import { saveSkillForReview } from '../skills/shared-store';
import { createWorkflowRunner } from '../workflows/runner';
import { resolveActiveTask, setActiveTask } from '../agent-state/session-memory';
import { renderTaskStatePrompt, recordFailedAttempt, applyCorrection } from '../agent-state/task-state';
import type { RecentAction } from '../agent-state/types';
import type { SkillRuntimeContext } from '../skills/types';
import { verifyBeforeComplete, rejectionMessage } from './completion-guard';
import { detectPageState } from '../browser-workflows/detect-page-state';
import { manualHandoffMessage } from '../browser-workflows/manual-blockers';
import { sanitizeArgs } from '../tools/audit';
import type { DocumentReference } from '../references/types';
import { ingestReferences, buildReferenceMessageContent } from '../references/ingest';
import type { ReferencedContext } from '../mentions/types';
import { resolveReferencedContext } from '../mentions/resolve';
import {
  buildCoworkerPromptContext,
  recordMemoryUsage,
  startTaskTracker,
  type TaskTracker,
} from '../coworker/run-context';
import { blockedStatusFor } from '../tasks/evidence';
import { deductCredits } from '../credit-engine';

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'waiting_user' | 'complete' | 'error';
export type AutonomyMode = 'full' | 'semi' | 'manual';

export interface AgentStep {
  id: string;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error' | 'approval' | 'plan' | 'checklist' | 'verification' | 'handoff' | 'blocked' | 'narration';
  tool?: string;
  input?: string;
  output?: string;
  error?: string;
  timestamp: string;
  risk?: string;
  details?: Record<string, unknown>;
}

export interface AgentLoopCallbacks {
  onStatus: (status: AgentStatus) => void;
  onStep: (step: AgentStep) => void;
  onAskUser: (question: string) => Promise<string>;
  onComplete: (summary: string) => void;
  onError: (error: string) => void;
  /**
   * Optional dedicated approval prompt. The UI returns a structured decision:
   * approve/deny, or `steer` with free-text `feedback` (the "Other" option) that
   * the loop turns into a re-plan. Falls back to onAskUser yes/no.
   */
  onApproval?: (req: { action: string; risk: string; reason: string; argsSummary: string }) => Promise<ApprovalPromptResult>;
  onAudit?: (entry: AuditEntry) => void;
}

export interface AgentAbortSignal {
  aborted: boolean;
}

export interface RunOptions {
  policy?: RiskPolicy;
  /** Raw autonomy mode for this run; drives the semi-mode hybrid gate + prompt. */
  autonomyMode?: AutonomyMode;
  sessionId?: string;
  /** Active workspace for this run. Falls back to the user's default workspace. */
  workspaceId?: string;
  /** Optional role template id shaping the prompt + skill ranking. */
  roleId?: string;
  /** Optional workflow template id whose steps/verification guide the run. */
  workflowTemplateId?: string;
  workspaceRoot?: string;
  connections?: ConnectionRegistry;
  skills?: SkillRunner;
  workflows?: WorkflowRunner;
  /** Prior conversation turns, oldest first. Gives the loop real context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  references?: ReferencedContext[];
}

/** How many prior turns to feed into the prompt window. */
const HISTORY_WINDOW = 8;

const MAX_ITERATIONS = 40;

function nowStepId(suffix: string): string {
  return `step-${Date.now()}-${suffix}`;
}

function coerceRows(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell)));
  return rows.length ? rows : undefined;
}

function valuesFromRows(rows: string[][]): string[] {
  return rows.flat().map((cell) => cell.trim()).filter(Boolean);
}

function tsvRows(text: string): string[][] | undefined {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  return rows.length ? rows : undefined;
}

function rememberExpectedSheetData(taskState: import('../agent-state/types').ActiveTaskState, action: ControlAction): void {
  if (action.action === 'connection.call' && /google\.sheets\.(write_values|append_values)/i.test(action.tool)) {
    const rows = coerceRows(action.args.values ?? action.args.rows);
    if (rows) {
      taskState.expectedData = { rows, values: valuesFromRows(rows), source: action.tool };
      const artifact = taskState.expectedArtifacts?.find((a) => a.type === 'table');
      if (artifact) {
        artifact.rows = rows;
        artifact.values = valuesFromRows(rows);
      }
    }
  }
  if (action.action === 'browser.paste' && typeof action.text === 'string') {
    const rows = tsvRows(action.text);
    if (rows) taskState.expectedData = { rows, values: valuesFromRows(rows), source: 'browser.paste' };
  }
  if (action.action === 'clipboard.set') {
    const rows = tsvRows(action.text);
    if (rows) taskState.expectedData = { rows, values: valuesFromRows(rows), source: 'clipboard.set' };
  }
  if (action.action === 'connection.call' && /google\.docs\.(insert_text|batch_update)/i.test(action.tool)) {
    const values: string[] = [];
    if (typeof action.args.text === 'string') values.push(action.args.text);
    const requests = action.args.requests;
    if (Array.isArray(requests)) {
      for (const request of requests) {
        const text = (request as { insertText?: { text?: unknown } })?.insertText?.text;
        if (typeof text === 'string') values.push(text);
      }
    }
    const compact = values.map((v) => v.trim()).filter(Boolean);
    if (compact.length) taskState.expectedData = { values: compact, source: action.tool };
  }
  if ((action.action === 'doc.write_docx' || action.action === 'doc.write_txt') && typeof action.content === 'string') {
    const parts = action.content
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 2)
      .slice(0, 8);
    if (parts.length) taskState.expectedData = { values: parts, source: action.action };
  }
}

function surfaceLabel(surface?: string): string {
  switch (surface) {
    case 'connection': return 'the configured connection/API';
    case 'browser': return 'the browser page';
    case 'local_files': return 'local files';
    case 'cli': return 'command-line tools';
    case 'app': return 'the desktop app';
    default: return 'the most direct available tool';
  }
}

function buildInitialPlanSummary(taskState: import('../agent-state/types').ActiveTaskState): string {
  const target = taskState.targetDocument?.type
    ? `${taskState.targetDocument.type.replace(/_/g, ' ')} target`
    : taskState.targetApp
      ? `${taskState.targetApp} task`
      : 'requested outcome';
  const verification = taskState.expectedOutcome
    ? `I will verify it against: ${taskState.expectedOutcome}`
    : 'I will verify the result with a read-back before finishing.';
  return `I understand the goal as: ${taskState.currentGoal}. Primary route: ${surfaceLabel(taskState.targetSurface)} for the ${target}. ${verification}`;
}

function isGoogleWorkspaceBrowserUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const full = `${host}${parsed.pathname}`.toLowerCase();
    return host === 'docs.new' ||
      host === 'sheets.new' ||
      full.includes('docs.google.com/document') ||
      full.includes('docs.google.com/spreadsheets') ||
      full.includes('drive.google.com') ||
      full.includes('mail.google.com');
  } catch {
    return /\b(docs\.new|sheets\.new|docs\.google\.com\/document|docs\.google\.com\/spreadsheets|drive\.google\.com|mail\.google\.com)\b/i.test(url);
  }
}

function googleConnectionFallbackAllowed(recentActions: RecentAction[]): boolean {
  return recentActions.some((action) => {
    if (action.action !== 'connection.call') return false;
    if (!/google-workspace|google\.(docs|sheets|drive|gmail)\./i.test(action.argsSummary ?? '')) return false;
    if (action.success) return false;
    return /missing_auth|unavailable|unsupported|not_configured|needs_setup|expired|invalid_auth|connection/i.test(`${action.error ?? ''} ${action.output ?? ''}`);
  });
}

export function shouldBlockBrowserBeforeConnection(args: {
  action: ControlAction;
  taskState: import('../agent-state/types').ActiveTaskState;
  recentActions: RecentAction[];
  connections?: ConnectionRegistry;
}): string | null {
  const { action, taskState, recentActions, connections } = args;
  if (action.action !== 'browser.open') return null;
  if (!isGoogleWorkspaceBrowserUrl(action.url)) return null;
  const googleTask = taskState.intent === 'spreadsheet_cloud' ||
    taskState.intent === 'document_cloud' ||
    taskState.targetDocument?.type === 'google_sheet' ||
    taskState.targetDocument?.type === 'google_doc' ||
    /google\s*(workspace|docs?|sheets?|drive|gmail)|docs\.new|sheets\.new/i.test(taskState.currentGoal);
  if (!googleTask) return null;
  if (!connections?.isConfigured('google-workspace')) return null;
  if (googleConnectionFallbackAllowed(recentActions)) return null;
  return 'connection_first_required: Google Workspace tasks must try connection.call with google-workspace before opening Google Workspace in the browser.';
}

function isSpreadsheetEnrichmentRequest(task: string): boolean {
  return /\b(fill|populate|update|edit|write into|write|enrich|process|keresd|t[oĂ¶]lts|Ă­rj|ird|Ă­rd|elemezd|adat)\b/i.test(task) &&
    /\b(table|sheet|spreadsheet|excel|csv|ods|t[aĂˇ]bl[aĂˇ]zat|sor|c[eĂ©]g|company)\b/i.test(task);
}

function inferCompanyRequiredColumns(task: string, header: string[]): string[] {
  const lower = task.toLowerCase();
  const wanted = new Set<string>();
  for (const col of header) {
    if (col.trim()) wanted.add(col.trim());
  }
  const add = (label: string) => wanted.add(label);
  if (/weboldal|website|honlap|link/i.test(lower)) add('Weboldal linkje');
  if (/email|e-mail|mail/i.test(lower)) add('Email cime');
  if (/telefon|phone/i.test(lower)) add('Telefon szam');
  if (/ipar[aĂˇ]g|industry/i.test(lower)) add('Iparag');
  if (/forr[aĂˇ]s|source|keresd|internet|web/i.test(lower)) add('Forras URL');
  if (/bizonyoss[aĂˇ]g|confidence|biztos/i.test(lower)) add('Bizonyossag');
  return [...wanted];
}

function inferSpreadsheetScopeFromIngest(
  taskState: import('../agent-state/types').ActiveTaskState,
  ingest: Awaited<ReturnType<typeof ingestReferences>>,
  task: string,
): void {
  if (!isSpreadsheetEnrichmentRequest(task) || taskState.expectedScope) return;
  for (const item of ingest.perRef) {
    const refPath = item.ref.path;
    if (!refPath || !/\.(xlsx|xlsm|xls|csv|ods)$/i.test(refPath)) continue;
    const structured = item.documentRead?.structured as { rows?: unknown[]; sheet?: string; row_count?: number; total_rows?: number } | undefined;
    const rows = Array.isArray(structured?.rows)
      ? structured.rows.filter((row): row is unknown[] => Array.isArray(row)).map((row) => row.map((cell) => String(cell ?? '').trim()))
      : [];
    if (rows.length < 2) continue;
    const header = rows[0] ?? [];
    const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim())).length;
    if (dataRows === 0) continue;
    taskState.expectedScope = {
      kind: 'spreadsheet_rows',
      sourcePath: refPath,
      sheet: structured?.sheet,
      headerRow: 1,
      dataRows,
      requiredRows: Array.from({ length: dataRows }, (_, i) => i + 2),
      requiredColumns: inferCompanyRequiredColumns(task, header),
      allowPartial: /\b(sample|first\s+\d+|els[oĹő]\s+\d+|allow partial|r[eĂ©]szleges)\b/i.test(task),
    };
    taskState.pendingChecks = [...new Set([
      ...taskState.pendingChecks,
      `Process all ${dataRows} spreadsheet data rows`,
      'Write back to the original spreadsheet target',
      'Read back row/header coverage',
    ])];
    break;
  }
}

/** Max page images to forward to vision per read (economy: caps token cost). */
const MAX_MIDLOOP_VISION_IMAGES = 8;

/** Page-image data URLs carried by a document read result (scanned PDFs), if any. */
function pageImagesFromResult(result: import('./types').ControlToolResult): string[] {
  const out: string[] = [];
  const details = result.details as { documentRead?: unknown; documentReads?: unknown[] } | undefined;
  const collect = (dr: unknown) => {
    const d = dr as { imageDataUrls?: unknown; imageDataUrl?: unknown } | undefined;
    if (Array.isArray(d?.imageDataUrls)) out.push(...d.imageDataUrls.filter((u): u is string => typeof u === 'string'));
    else if (typeof d?.imageDataUrl === 'string') out.push(d.imageDataUrl);
  };
  if (details?.documentRead) collect(details.documentRead);
  if (Array.isArray(details?.documentReads)) details.documentReads.forEach(collect);
  return out.slice(0, MAX_MIDLOOP_VISION_IMAGES);
}

async function updateOverlay(state: object): Promise<void> {
  try { await emit('agent-overlay-update', state); } catch { /* optional */ }
}

async function finalDeduct(userId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0 || !userId) return;
  try {
    const result = await deductCredits({ userId, usdCost: costUsd, source: 'ai_model:agent_loop' });
    if (!result.deducted) console.warn('Agent credit deduction failed');
  } catch (err) {
    console.warn('Agent credit deduction failed:', err);
  }
}

async function completeStopped(
  onStatus: AgentLoopCallbacks['onStatus'],
  onComplete: AgentLoopCallbacks['onComplete'],
  tracker?: TaskTracker,
): Promise<void> {
  await tracker?.setStatus('cancelled');
  await updateOverlay({ active: false, status: 'complete' });
  onStatus('complete');
  onComplete('Stopped.');
}

export async function runControlLoop(
  task: string,
  modelId: string,
  userId: string,
  callbacks: AgentLoopCallbacks,
  signal?: AgentAbortSignal,
  opts: RunOptions = {},
): Promise<void> {
  const { onStatus, onStep, onAskUser, onComplete, onError } = callbacks;
  const steps: AgentStep[] = [];
  // Mutable task tracker: starts as a no-op and is replaced once the persistent
  // TaskRun is created. emitStep persists each step as evidence (best-effort).
  let tracker: TaskTracker = { taskRunId: undefined, async recordStep() {}, async setStatus() {} };
  const emitStep = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
    void tracker.recordStep(step);
  };

  let totalCostUsd = 0;
  const sessionId = opts.sessionId ?? `sess-${Date.now()}`;
  const references = opts.references ?? [];

  // Resolve workspace context (workspace summary + relevant memory + skills) and
  // start persistent task tracking. All best-effort: failures never block the run.
  const coworker = await buildCoworkerPromptContext({
    userId, sessionId, task,
    workspaceId: opts.workspaceId,
    roleId: opts.roleId,
    workflowTemplateId: opts.workflowTemplateId,
  });
  // An explicit policy wins; otherwise derive it from the workspace autonomy mode
  // so automations/tasks honour manual/semi/full the same way chat does.
  const autonomyMode: AutonomyMode = opts.autonomyMode ?? coworker.workspace?.autonomyMode ?? 'semi';
  const policy: RiskPolicy = opts.policy ?? policyForAutonomyMode(autonomyMode);
  const workspaceRoot = opts.workspaceRoot ?? coworker.workspaceRoot ?? '~';
  tracker = await startTaskTracker({
    userId,
    workspaceId: coworker.workspace?.id ?? opts.workspaceId,
    sessionId,
    task,
    modelId,
    autonomyMode: coworker.workspace?.autonomyMode ?? 'semi',
    roleId: coworker.roleId,
    workflowTemplateId: coworker.workflowTemplateId,
  });

  const audit = new MemoryAuditLogger((entry) => callbacks.onAudit?.(entry));
  const approvals = new PromptApprovalService(async (req) => {
    if (callbacks.onApproval) {
      return callbacks.onApproval({ action: req.action.action, risk: req.risk, reason: req.reason, argsSummary: req.argsSummary });
    }
    emitStep({ id: nowStepId('approval'), type: 'approval', tool: req.action.action, risk: req.risk, output: req.reason, timestamp: new Date().toISOString() });
    const answer = await onAskUser(`Approval needed for ${req.action.action} (${req.risk}). ${req.reason}\nArgs: ${req.argsSummary}\nReply "yes" to allow, "no" to reject, or type a different instruction.`);
    if (/^\s*(y|yes|allow|ok)\b/i.test(answer)) return { decision: 'allow_once' };
    if (/^\s*(n|no|deny|reject|stop)\b/i.test(answer) || !answer.trim()) return { decision: 'deny' };
    // Anything else is treated as steering feedback → re-plan.
    return { decision: 'steer', feedback: answer.trim() };
  }, 'deny', {
    userId,
    workspaceId: coworker.workspace?.id ?? opts.workspaceId,
    taskRunId: tracker.taskRunId,
  });

  const connections = opts.connections ?? createConnectionRegistry(userId, coworker.workspace?.id ?? opts.workspaceId);
  // Scope the skill runner to the resolved workspace so enabled user/workspace
  // builder skills (Phase 2) are runnable alongside the bundled ones.
  const skills = opts.skills ?? createSkillRunner({ userId, workspaceId: coworker.workspace?.id ?? opts.workspaceId });
  const workflows = opts.workflows ?? createWorkflowRunner();

  onStatus('planning');
  emitStep({
    id: nowStepId('mode'),
    type: 'plan',
    output: 'Preparing the task target, primary route, response language, and verification before acting.',
    timestamp: new Date().toISOString(),
  });
  await updateOverlay({ active: true, status: 'planning', task, steps });

  // ── Persistent task / context memory ──────────────────────────────────────
  // Resolve the active task for this session: a correction/continuation folds
  // into the prior task; otherwise a fresh task is classified by preflight.
  const resolved = resolveActiveTask(sessionId, task);
  const taskState = resolved.state;
  taskState.status = 'running';
  emitStep({
    id: nowStepId('task-plan'),
    type: 'plan',
    output: buildInitialPlanSummary(taskState),
    timestamp: new Date().toISOString(),
  });
  const resolvedReferences = references.length
    ? await resolveReferencedContext({
        references,
        userId,
        workspaceId: coworker.workspace?.id ?? opts.workspaceId,
      })
    : { promptBlock: '', blockers: [], documentReferences: [] as DocumentReference[] };

  if (resolvedReferences.blockers.length) {
    const message = `Referenced context is not ready:\n${resolvedReferences.blockers.map((b) => `- ${b}`).join('\n')}`;
    emitStep({ id: nowStepId('reference-blocker'), type: 'blocked', output: message, timestamp: new Date().toISOString() });
    await tracker.setStatus('blocked', { error: message });
    onError(message);
    await updateOverlay({ active: false, status: 'error' });
    return;
  }

  taskState.referencedInputs = resolvedReferences.documentReferences;
  const ctx = { userId, sessionId, workspaceRoot, task, references: resolvedReferences.documentReferences, audit, approvals, connections, skills, workflows, onAskUser, activeSkills: taskState.activeSkills ?? [] as SkillRuntimeContext[], autonomyMode, addCost: (usd: number) => { totalCostUsd += usd; } };
  if (resolved.isCorrection) {
    emitStep({
      id: nowStepId('correction'),
      type: 'thinking',
      output: `Correction detected — continuing the active task: ${taskState.currentGoal}`,
      timestamp: new Date().toISOString(),
    });
  }

  const recentActions: RecentAction[] = [];
  const MAX_RECENT = 40;
  const recordAction = (rec: RecentAction) => {
    recentActions.push(rec);
    if (recentActions.length > MAX_RECENT) recentActions.shift();
  };

  let proactiveResearch: SkillResearchSummary | null = null;
  if (coworker.skillRoute) {
    const gap = detectSkillGap(coworker.skillRoute, {
      task,
      userMessage: task,
      activeWorkspaceId: coworker.workspace?.id ?? opts.workspaceId,
      references: resolvedReferences.documentReferences,
      availableTools: [],
      availableConnections: [],
      enabledSkillIds: [],
      currentSurface: taskState.targetSurface === 'local_files' || taskState.targetSurface === 'browser'
        ? taskState.targetSurface
        : 'unknown',
    });
    if (gap.kind === 'learnable') {
      emitStep({
        id: nowStepId('skill-gap'),
        type: 'thinking',
        output: `Potential reusable skill gap detected for ${gap.target?.label ?? 'this workflow'}: ${gap.reason}`,
        timestamp: new Date().toISOString(),
      });
      emitStep({
        id: nowStepId('skill-research-call'),
        type: 'tool_call',
        tool: 'web.search',
        input: JSON.stringify({ query: `${gap.target?.label ?? ''} ${task}`.trim(), reason: 'skill_gap_research' }),
        timestamp: new Date().toISOString(),
      });
      try {
        proactiveResearch = await researchSkillGap(gap, { userId });
        const output = JSON.stringify({
          target: proactiveResearch.targetLabel,
          query: proactiveResearch.query,
          sources: proactiveResearch.sources.map((source) => ({ title: source.title, url: source.url })),
          workflowSteps: proactiveResearch.workflowSteps,
          apiFirstRecommendation: proactiveResearch.apiFirstRecommendation,
          blockers: proactiveResearch.blockers,
        }, null, 2);
        emitStep({
          id: nowStepId('skill-research-result'),
          type: 'tool_result',
          tool: 'web.search',
          output,
          timestamp: new Date().toISOString(),
          details: { skillResearch: proactiveResearch },
        });
        recordAction({ action: 'web.search', argsSummary: proactiveResearch.query, success: true, output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitStep({
          id: nowStepId('skill-research-error'),
          type: 'error',
          tool: 'web.search',
          error: message,
          timestamp: new Date().toISOString(),
        });
        recordAction({ action: 'web.search', argsSummary: gap.target?.label, success: false, error: message });
      }
    }
  }

  const preloadedSkillBlocks: string[] = [];
  const autoSkillNames: string[] = [];
  const addAutoSkill = (name: string | undefined) => {
    if (name && !autoSkillNames.includes(name)) autoSkillNames.push(name);
  };
  const primaryRoute = coworker.skillRoute?.primarySkill;
  const autoPrimarySelected = Boolean(primaryRoute && primaryRoute.confidence >= 0.6);
  if (autoPrimarySelected && coworker.skillRoute?.selectedChain.length) {
    for (const route of coworker.skillRoute.selectedChain) addAutoSkill(route.name);
  } else if (primaryRoute && autoPrimarySelected) {
    addAutoSkill(primaryRoute.name);
  }
  for (const route of coworker.skillRoute?.selectedSkills ?? []) {
    if (route.reason.includes('explicit @skill mention')) addAutoSkill(route.name);
  }
  const primaryRisk = primaryRoute?.manifest.risk;
  if (autoPrimarySelected && primaryRisk && primaryRisk !== 'read_only') addAutoSkill('task-verification');

  for (const skillName of autoSkillNames) {
    const action: ControlAction = { action: 'skill.run', skill: skillName, input: { task, autoSelected: true } };
    emitStep({ id: nowStepId('skill-run'), type: 'tool_call', tool: 'skill.run', input: JSON.stringify(action), timestamp: new Date().toISOString() });
    const result = await runControlAction(action, ctx, policy);
    emitStep({
      id: nowStepId('skill-result'),
      type: result.success ? 'tool_result' : 'error',
      tool: 'skill.run',
      output: result.output,
      error: result.error,
      timestamp: new Date().toISOString(),
      details: result.details,
    });
    recordAction({
      action: 'skill.run',
      argsSummary: skillName,
      success: result.success,
      output: result.output,
      error: result.error,
    });
    const runtimeContext = result.details?.runtimeContext as SkillRuntimeContext | undefined;
    if (result.success && runtimeContext) {
      ctx.activeSkills = [...(ctx.activeSkills ?? []), runtimeContext];
      taskState.activeSkills = ctx.activeSkills;
      taskState.skillVerification = {
        requiredEvidence: ctx.activeSkills.flatMap((skill) => skill.verificationChecklist.filter((check) => check.required).map((check) => check.title)),
        completedEvidence: [],
      };
      preloadedSkillBlocks.push(result.output);
      setActiveTask(sessionId, taskState);
    }
  }

  // Read attached references into model-ready content (text + image blocks).
  // Shared with the normal chat path via ../references/ingest.
  const ingest = resolvedReferences.documentReferences.length > 0 ? await ingestReferences(resolvedReferences.documentReferences, task, { userId }) : null;
  if (ingest) {
    emitStep({
      id: nowStepId('refs-plan'),
      type: 'checklist',
      output: `Referenced inputs: ${resolvedReferences.documentReferences.map((ref) => ref.label).join(', ')}. I will inspect them before using their contents.`,
      timestamp: new Date().toISOString(),
    });
    for (const item of ingest.perRef) {
      const tool = item.kind === 'folder' ? 'folder.scan' : 'document.read';
      emitStep({
        id: nowStepId(item.kind === 'folder' ? 'folder-scan' : 'document-read'),
        type: item.ok ? 'verification' : 'error',
        tool,
        input: JSON.stringify(item.ref),
        output: item.output,
        error: item.error,
        timestamp: new Date().toISOString(),
        details: item.kind === 'folder' ? { folderScan: item.folderScan } : { documentRead: item.documentRead },
      });
      recordAction({ action: tool, argsSummary: JSON.stringify(item.ref), success: item.ok, output: item.output, error: item.error });
    }
    if (ingest.filesRead.length) {
      taskState.filesRead = [...(taskState.filesRead ?? []), ...ingest.filesRead];
    }
    inferSpreadsheetScopeFromIngest(taskState, ingest, task);
    setActiveTask(sessionId, taskState);
  }

  const history = (opts.history ?? []).slice(-HISTORY_WINDOW);
  const historyBlock = history.length
    ? `\n\n## Recent conversation\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : '';

  const coworkerBlock = [coworker.promptBlock, resolvedReferences.promptBlock].filter(Boolean).join('\n\n');
  const coworkerPromptBlock = coworkerBlock ? `\n\n${coworkerBlock}` : '';
  const activeSkillPromptBlock = preloadedSkillBlocks.length ? `\n\n${preloadedSkillBlocks.join('\n\n')}` : '';
  const proactiveLearningBlock = proactiveResearch
    ? `\n\n## Skill-gap research\nTarget: ${proactiveResearch.targetLabel}\nWorkflow hints: ${proactiveResearch.workflowSteps.join('; ') || 'none'}\nAPI-first note: ${proactiveResearch.apiFirstRecommendation ?? 'none'}\nKnown blockers: ${proactiveResearch.blockers.join('; ') || 'none'}\nUse this as background only. Execute through normal tools, approval gates, and verification.`
    : '';
  const systemPrompt =
    `${CONTROL_SYSTEM_PROMPT}\n\n${autonomyModePrompt(autonomyMode)}\n\n## Tool catalog\n${toolCatalogSummary()}\n\n## Workspace\n${workspaceRoot}${coworkerPromptBlock}` +
    `${activeSkillPromptBlock}${proactiveLearningBlock}${historyBlock}\n\n${renderTaskStatePrompt(taskState)}\n\n## Current message\n${task}`;

  // Surfaced memory counts as used (drives recency boost), fire-and-forget.
  void recordMemoryUsage(coworker.usedMemoryIds);

  const messages: { role: 'user' | 'assistant' | 'system'; content: MessageContent }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  // Inject the actual contents of attached references (text + images) so the
  // model can analyze them directly instead of only seeing their labels.
  const refContent = ingest ? buildReferenceMessageContent(ingest) : null;
  if (refContent) {
    messages.push({ role: 'user', content: refContent });
  }

  // Rolling record of executed actions — the evidence the completion guard checks.
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }

    onStatus('executing');
    await updateOverlay({ active: true, status: 'executing', task, steps });

    let aiResponse = '';
    let streamError = '';
    const streamController = new AbortController();
    const abortPoll = globalThis.setInterval(() => {
      if (signal?.aborted) streamController.abort();
    }, 60);
    try {
      await callOpenRouterWithTools(
        messages, modelId, userId,
        (chunk) => { aiResponse += chunk; },
        (usage) => { totalCostUsd += usage.costUsd; },
        (err) => { streamError = err; },
        false,
        streamController.signal,
      );
    } finally {
      globalThis.clearInterval(abortPoll);
    }
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }
    if (streamError) { await tracker.setStatus('failed', { error: streamError }); onError(streamError); await updateOverlay({ active: false }); return; }

    // Reject any retired mouse/cursor/visual action by name before parsing.
    const attempted = aiResponse.match(/"(?:action|tool)"\s*:\s*"([^"]+)"/)?.[1] ?? '';
    if (attempted && isLegacyVisualActionName(attempted)) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `Rejected "${attempted}": that retired desktop-control action is unavailable. Use structured tools such as CLI, files, browser DOM, connections, skills, visualization.render, or ask_user for a manual handoff.` });
      emitStep({ id: nowStepId('legacy-blocked'), type: 'error', tool: attempted, error: 'mouse_cursor_visual_not_supported', timestamp: new Date().toISOString() });
      continue;
    }

    const action = parseControlAction(aiResponse);
    if (!action) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: 'Invalid action JSON. Return exactly one allowed action object with an "action" field.' });
      emitStep({ id: nowStepId('parse-error'), type: 'error', error: 'invalid_control_action', output: aiResponse.slice(0, 500), timestamp: new Date().toISOString() });
      continue;
    }

    // Surface the model's reasoning prose as a human-readable narration line so
    // the chat reads like a coworker, not a tool log. The tool call itself stays
    // in the (collapsed-by-default) timeline.
    const narration = sanitizeUserVisibleNarration(extractNarration(aiResponse));
    if (isMeaningfulNarration(narration)) {
      emitStep({ id: nowStepId('narration'), type: 'narration', output: narration, timestamp: new Date().toISOString() });
    }

    const connectionFirstBlock = shouldBlockBrowserBeforeConnection({
      action: action as ControlAction,
      taskState,
      recentActions,
      connections,
    });
    if (connectionFirstBlock) {
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({
        role: 'user',
        content: `${connectionFirstBlock}\nUse connection.call with connection "google-workspace" first. Only use browser.open for Google Workspace after the connection is missing, unavailable, unsupported, or blocked by auth.`,
      });
      emitStep({
        id: nowStepId('connection-first-blocked'),
        type: 'error',
        tool: action.action,
        error: 'connection_first_required',
        output: connectionFirstBlock,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const stepId = nowStepId('action');
    emitStep({ id: stepId, type: 'tool_call', tool: action.action, input: JSON.stringify(action, null, 2), timestamp: new Date().toISOString() });

    if (action.action === 'ask_user') {
      onStatus('waiting_user');
      taskState.status = 'waiting_user';
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('needs_input');
      const answer = await onAskUser(action.question);
      if (signal?.aborted) {
        await completeStopped(onStatus, onComplete, tracker);
        return;
      }
      taskState.status = 'running';
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('running');
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({ role: 'user', content: `User answered: ${answer}\nResume the SAME active task with the same goal.` });
      continue;
    }

    if (action.action === 'task.complete') {
      // Completion guard: do not close the run unless the requested outcome is
      // actually proven by the recorded evidence. On reject, keep looping.
      const guard = verifyBeforeComplete(taskState, recentActions);
      emitStep({
        id: nowStepId('verification'),
        type: 'verification',
        tool: 'task.complete',
        output: guard.ok ? `Verification passed: ${guard.reason}` : `Verification failed: ${guard.reason}`,
        error: guard.ok ? undefined : 'completion_rejected',
        timestamp: new Date().toISOString(),
      });
      if (!guard.ok) {
        recordFailedAttempt(taskState, {
          step: 'task.complete',
          reason: guard.reason,
          tool: 'task.complete',
        });
        setActiveTask(sessionId, taskState);
        emitStep({
          id: nowStepId('complete-rejected'),
          type: 'error',
          tool: 'task.complete',
          error: 'completion_rejected',
          output: guard.reason,
          timestamp: new Date().toISOString(),
        });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({ role: 'user', content: rejectionMessage(guard) });
        continue;
      }
      taskState.status = 'complete';
      taskState.completedChecks = [...taskState.pendingChecks];
      taskState.pendingChecks = [];
      setActiveTask(sessionId, taskState);
      await tracker.setStatus('completed', { summary: action.summary });
      if (proactiveResearch && tracker.taskRunId && (coworker.workspace?.id ?? opts.workspaceId)) {
        const learned = await synthesizeSelfLearnedSkill({
          userId,
          workspaceId: coworker.workspace?.id ?? opts.workspaceId,
          taskRunId: tracker.taskRunId,
          task,
          evidence: recentActions,
          research: proactiveResearch,
        }).catch((error) => {
          console.warn('Self-learned skill synthesis failed:', error);
          return null;
        });
        if (learned && learned.dryRun.ok) {
          emitStep({
            id: nowStepId('self-skill-review'),
            type: 'handoff',
            tool: 'ask_user',
            output: `Learned skill draft ready: ${learned.skill.name}`,
            timestamp: new Date().toISOString(),
          });
          await tracker.setStatus('needs_input');
          const answer = await onAskUser(`I found a reusable pattern for "${learned.skill.name}". Save it as a private workspace skill draft for review? Reply yes or no.`);
          await tracker.setStatus('completed', { summary: action.summary });
          if (/^\s*(y|yes|ok|save|igen)\b/i.test(answer)) {
            await saveSkillForReview({
              skill: learned.skill,
              source: 'self_learned',
              userId,
              workspaceId: coworker.workspace?.id ?? opts.workspaceId,
              status: 'pending_review',
              originTaskRunId: tracker.taskRunId,
            });
            emitStep({
              id: nowStepId('self-skill-saved'),
              type: 'tool_result',
              tool: 'skill.run',
              output: `Saved self-learned skill draft for review: ${learned.skill.name}`,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      void learnFromCompletedTask({
        userId,
        workspaceId: coworker.workspace?.id ?? opts.workspaceId,
        taskRunId: tracker.taskRunId,
        title: taskState.currentGoal,
        prompt: task,
        activeSkillIds: (taskState.activeSkills ?? []).map((skill) => skill.skillId),
        recentActions,
        autoLearnLowRisk: coworker.workspace?.skillLearningConfig?.autoLearnLowRisk ?? true,
      }).catch((error) => console.warn('Skill learning failed:', error));
      await finalDeduct(userId, totalCostUsd);
      emitStep({ id: nowStepId('complete'), type: 'complete', output: action.summary, timestamp: new Date().toISOString() });
      await updateOverlay({ active: false, status: 'complete', task, steps });
      onStatus('complete');
      onComplete(action.summary);
      return;
    }

    const result = await runControlAction(action as ControlAction, ctx, policy);
    if (signal?.aborted) {
      await completeStopped(onStatus, onComplete, tracker);
      return;
    }

    // Human-in-the-loop: the user reviewed this action at the approval gate and
    // did NOT approve it. Either they steered (typed an instruction via "Other")
    // or rejected it. Both feed back into the loop as a re-plan rather than
    // executing the proposed action.
    if (result.approvalRequired) {
      const steer = result.approvalFeedback?.trim();
      if (steer) {
        applyCorrection(taskState, steer, 'User redirected the agent at the approval gate', []);
        setActiveTask(sessionId, taskState);
        emitStep({
          id: `${stepId}-steer`,
          type: 'approval',
          tool: action.action,
          output: `User redirected instead of approving: ${steer}`,
          timestamp: new Date().toISOString(),
        });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `I did NOT approve the proposed "${action.action}" action. Instead, do this: ${steer}\nRe-plan your next actions accordingly and continue the SAME task.`,
        });
      } else {
        emitStep({
          id: `${stepId}-rejected`,
          type: 'approval',
          tool: action.action,
          error: 'approval_denied',
          output: `User rejected the "${action.action}" action.`,
          timestamp: new Date().toISOString(),
        });
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `I rejected the proposed "${action.action}" action. Do not retry it; choose a safer alternative for the SAME task, or ask me what to do instead.`,
        });
      }
      continue;
    }

    emitStep({
      id: `${stepId}-result`,
      type: result.success ? 'tool_result' : 'error',
      tool: action.action,
      output: result.output,
      error: result.error,
      timestamp: new Date().toISOString(),
      details: result.details,
    });
    await updateOverlay({ active: true, status: 'executing', task, steps });

    // Record evidence for the completion guard.
    if (result.success && action.action === 'skill.run') {
      const runtimeContext = result.details?.runtimeContext as SkillRuntimeContext | undefined;
      if (runtimeContext && !(ctx.activeSkills ?? []).some((skill) => skill.skillId === runtimeContext.skillId)) {
        ctx.activeSkills = [...(ctx.activeSkills ?? []), runtimeContext];
        taskState.activeSkills = ctx.activeSkills;
        taskState.skillVerification = {
          requiredEvidence: ctx.activeSkills.flatMap((skill) => skill.verificationChecklist.filter((check) => check.required).map((check) => check.title)),
          completedEvidence: taskState.skillVerification?.completedEvidence ?? [],
        };
      }
    }
    rememberExpectedSheetData(taskState, action as ControlAction);
    setActiveTask(sessionId, taskState);
    recordAction({
      action: action.action,
      argsSummary: sanitizeArgs(action),
      success: result.success,
      output: result.output,
      error: result.error,
    });

    // Browser state awareness: when a page read reveals a login / CAPTCHA wall,
    // mark the task blocked and steer the model to a manual handoff (not failure).
    let blockerNote = '';
    if (result.success && (action.action === 'browser.read' || action.action === 'browser.get_state' || action.action === 'browser.open')) {
      const pageState = detectPageState(result.output);
      taskState.lastKnownState = `${pageState.kind}${pageState.url ? ` @ ${pageState.url}` : ''}`;
      if (pageState.isManualBlocker) {
        taskState.status = 'blocked';
        const blocker = pageState.kind === 'login_required' ? 'login' : pageState.kind === 'captcha' ? 'captcha' : 'permission';
        await tracker.setStatus(blockedStatusFor(blocker));
        blockerNote = `\nMANUAL BLOCKER (${pageState.kind}). Do NOT complete. ask_user: "${manualHandoffMessage(pageState.kind === 'login_required' ? 'login_required' : pageState.kind === 'captcha' ? 'captcha' : 'permission_required')}" Then resume the same task.`;
      }
      setActiveTask(sessionId, taskState);
    }

    // Visual self-check: fold the screenshot verdict into task state, steer on
    // visible blockers, and surface the screenshot to the acting model so it SEES
    // the page next turn (perception only — never pixel control).
    let visualNote = '';
    let verdictImages: string[] = [];
    if (result.success && action.action === 'screen.verify') {
      const verdict = result.details?.visualVerdict as import('./vision-verifier').VisualVerdict | undefined;
      if (verdict) {
        taskState.lastVisualVerdict = verdict;
        if (taskState.successCriteria?.length) {
          const met = new Set(verdict.metCriteria.map((c) => c.toLowerCase().trim()));
          for (const crit of taskState.successCriteria) {
            if (crit.method === 'structured') continue;
            crit.status = met.has(crit.text.toLowerCase().trim()) || verdict.done ? 'met' : 'unmet';
          }
        }
        if (verdict.blockers.length) {
          taskState.status = 'blocked';
          await tracker.setStatus('blocked');
          visualNote = `\nVISUAL BLOCKER: ${verdict.blockers.join('; ')}. Do NOT complete — ask_user to resolve it, then resume the same task.`;
        } else if (!verdict.done) {
          visualNote = `\nVisual check: NOT done (${verdict.progress}%). Unmet: ${verdict.unmetCriteria.join('; ') || '—'}. Next: ${verdict.nextStepHint || 'continue with structured tools and re-verify'}.`;
        } else {
          visualNote = `\nVisual check: DONE (${verdict.progress}%). The screen confirms the outcome.`;
        }
        await updateOverlay({ active: true, status: 'executing', task, steps, progress: verdict.progress });
        verdictImages = (result.details?.imageDataUrls as string[] | undefined) ?? [];
        setActiveTask(sessionId, taskState);
      }
    }

    messages.push({ role: 'assistant', content: aiResponse });
    messages.push({
      role: 'user',
      content: result.success
        ? `Action result: ${result.output}${blockerNote}${visualNote}\nComplete with task.complete only when the result is verified by a read-back and proves the requested outcome.`
        : `Action error: ${result.error ?? result.output}\nPick a different structured tool. If only a manual GUI path exists, ask_user for a manual step or an API/export alternative.`,
    });

    // Surface the captured screenshot to the acting model so it can see the real,
    // rendered screen (not just the DOM text) on the next turn.
    if (verdictImages.length) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `Screenshot(s) from the visual self-check just performed — look at the actual rendered screen and judge whether the task outcome is really present. Do not invent contents.` },
          ...verdictImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      });
    }

    // Scanned documents read mid-task (e.g. an image-only PDF via document.read) carry
    // page images. Surface them as a vision message so the model can actually read them
    // — capped for economy; only when present.
    if (result.success) {
      const pageImages = pageImagesFromResult(result);
      if (pageImages.length) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `Attached ${pageImages.length} page image(s) from the document just read — read them visually and extract the data. Do not invent contents.` },
            ...pageImages.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        });
      }
    }
  }

  await tracker.setStatus('failed', { error: `Reached maximum iterations (${MAX_ITERATIONS})` });
  await finalDeduct(userId, totalCostUsd);
  await updateOverlay({ active: false });
  onError(`Reached maximum iterations (${MAX_ITERATIONS})`);
}
