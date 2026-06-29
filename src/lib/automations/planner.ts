// Plans an automation into ordered, editable steps. It NEVER executes tools — it
// only asks the model (or a deterministic heuristic) to produce a plan. The plan
// always includes a verification/read-back step, an approval step when the goal
// involves send/publish/destructive actions, and flags missing dependencies.

import { callOpenRouterJson } from '../openrouter';
import type { AutomationStep, ReferencedContext } from './types';

export interface PlanInput {
  prompt: string;
  referencedContext: ReferencedContext[];
}

export interface PlanResult {
  steps: AutomationStep[];
  missingDependencies: string[];
}

let idc = 0;
function stepId(): string { return `step-${Date.now()}-${(idc++).toString(36)}`; }

function mkStep(order: number, title: string, instruction: string, refs: ReferencedContext[] = [], verificationHint?: string, required = true): AutomationStep {
  return { id: stepId(), title, instruction, referencedContext: refs, required, order, verificationHint };
}

const SEND_RE = /\b(send|email|post|publish|tweet|message|notify|share)\b/i;
const GOOGLE_SHEET_RE = /\b(google\s*(sheet|sheets|spreadsheet|t[aá]bl[aá]zat)|sheets\.new)\b|docs\.google\.com\/spreadsheets/i;
const GOOGLE_DOC_RE = /\b(google\s*(doc|docs|document|dokumentum)|google\s*dokumentum)\b|docs\.google\.com\/document/i;
const DRIVE_FOLDER_RE = /\b(google\s*drive|drive\s*(folder|mappa)|google\s*(folder|mappa))\b|drive\.google\.com/i;
const LOCAL_OUTPUT_RE = /\b(save|write|export|output|produce|create|ment|mentsd|k[eé]sz[ií]ts|hozz l[eé]tre)\b[\s\S]{0,80}\b(file|folder|f[aá]jl|mappa|xlsx|csv|pdf|docx|txt|report|riport)\b/i;

function googleRefs(refs: ReferencedContext[]): ReferencedContext[] {
  return refs.filter((r) => r.kind === 'connection' && /google|gmail|sheets|docs|drive|calendar/i.test(`${r.refId} ${r.label}`));
}

function hasExistingSheetTarget(prompt: string): boolean {
  return /docs\.google\.com\/spreadsheets\/d\/|spreadsheets\/d\/[a-zA-Z0-9_-]+/i.test(prompt);
}

function hasExistingDocTarget(prompt: string): boolean {
  return /docs\.google\.com\/document\/d\/|document\/d\/[a-zA-Z0-9_-]+/i.test(prompt);
}

function hasExistingDriveFolderTarget(prompt: string): boolean {
  return /drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+/i.test(prompt);
}

/** Deterministic plan used as a fallback and in tests (no network). */
export function heuristicSteps(input: PlanInput): AutomationStep[] {
  const connRefs = input.referencedContext.filter((r) => r.kind === 'connection');
  const gRefs = googleRefs(input.referencedContext);
  const steps: AutomationStep[] = [];
  let order = 0;

  if (connRefs.length > 0) {
    steps.push(mkStep(order++, 'Gather inputs', `Read the data needed for the task from ${connRefs.map((c) => c.label).join(', ')} using their read tools (no mouse).`, connRefs, 'Confirm each source returned data.'));
  }

  if (GOOGLE_SHEET_RE.test(input.prompt)) {
    steps.push(hasExistingSheetTarget(input.prompt)
      ? mkStep(order++, 'Validate Google Sheet', 'Use the provided Google Sheet URL or spreadsheetId. Call google.sheets.get_metadata or google.sheets.read_values before using it, and stop with a blocker if it is not accessible.', gRefs, 'Existing Google Sheet was read successfully.')
      : mkStep(order++, 'Create Google Sheet infrastructure', 'No concrete Google Sheet was provided. Create one with google.sheets.create, write the needed headers/template rows with google.sheets.write_values, then read it back with google.sheets.read_values. Use the created spreadsheetId for all later steps.', gRefs, 'Google Sheet was created, initialized, and read back.'));
  }

  if (GOOGLE_DOC_RE.test(input.prompt)) {
    steps.push(hasExistingDocTarget(input.prompt)
      ? mkStep(order++, 'Validate Google Doc', 'Use the provided Google Doc URL or documentId. Call google.docs.get_metadata or google.docs.read before updating it, and stop with a blocker if it is not accessible.', gRefs, 'Existing Google Doc was read successfully.')
      : mkStep(order++, 'Create Google Doc infrastructure', 'No concrete Google Doc was provided. Create one with google.docs.create, insert the required structure with google.docs.insert_text or google.docs.batch_update, then read it back with google.docs.read. Use the created documentId for all later steps.', gRefs, 'Google Doc was created, initialized, and read back.'));
  }

  if (DRIVE_FOLDER_RE.test(input.prompt)) {
    steps.push(hasExistingDriveFolderTarget(input.prompt)
      ? mkStep(order++, 'Validate Drive folder', 'Use the provided Drive folder URL or folderId. Call google.drive.get_file before storing outputs there, and stop with a blocker if it is not accessible.', gRefs, 'Existing Drive folder metadata was read successfully.')
      : mkStep(order++, 'Create Drive folder infrastructure', 'No concrete Drive folder was provided. Create one with google.drive.create_folder, verify it with google.drive.get_file, and use the created folderId for all later output steps.', gRefs, 'Drive folder was created and verified.'));
  }

  if (LOCAL_OUTPUT_RE.test(input.prompt)) {
    steps.push(mkStep(order++, 'Prepare local output infrastructure', 'If the workflow needs a local output file or folder, create the parent folder when needed, write the durable output with the right file/document/sheet/artifact tool, and verify file.exists plus read-back. Do not treat a missing output path as a missing input.', input.referencedContext.filter((r) => r.kind !== 'connection'), 'Local output exists and was read back.'));
  }

  steps.push(mkStep(order++, 'Do the work', input.prompt.trim() || 'Perform the requested task using the available tools and references.', input.referencedContext, 'Intermediate result looks correct.'));
  steps.push(mkStep(order++, 'Produce output', 'Write the result to a durable output (file/sheet/doc) so it can be verified.', [], 'Output artifact created.'));

  if (SEND_RE.test(input.prompt)) {
    steps.push(mkStep(order++, 'Request approval before sending', 'This task sends/publishes externally. Request explicit approval before the send/publish action.', [], 'User approved the external action.'));
  }

  steps.push(mkStep(order++, 'Verify and read back', 'Read back the produced output and confirm it satisfies the goal before completing. Do not call task.complete until verification passes.', [], 'Output was read back and matches the goal.'));
  return steps;
}

export function missingConnectionDeps(refs: ReferencedContext[], isConnected: (refId: string) => boolean): string[] {
  return refs.filter((r) => r.kind === 'connection' && !isConnected(r.refId)).map((r) => r.label);
}

function fallbackInstruction(title: string, goal: string): string {
  const cleanGoal = goal.trim() || 'the automation goal';
  return `Complete "${title}" for this automation. Use the available tools and referenced context, then leave evidence that the step was actually done. Goal: ${cleanGoal}`;
}

function referenceSummary(ref: ReferencedContext): string {
  const doc = ref.metadata?.documentReference as { path?: string; url?: string; kind?: string } | undefined;
  const target = doc?.path ?? doc?.url ?? ref.refId;
  return `${doc?.kind ?? ref.kind}:${ref.label}${target && target !== ref.label ? ` (${target})` : ''}`;
}

const PLANNER_SYSTEM = `You plan an AI coworker automation into concrete, ordered steps. You DO NOT execute anything — you only plan.
Rules:
- Larund is a no-mouse operator: use APIs/connections/MCP/files; never mouse/pixels/screenshots.
- Prefer connections/MCP over browser fallback.
- Do not assume target infrastructure exists. If no concrete Sheet/Doc/folder/file URL, id or path is referenced, add required setup steps that create it, initialize it, save the id/path/url in run evidence, and read it back.
- For Google Sheets plan google.sheets.create/write_values/read_values; for Docs plan google.docs.create/insert_text/read; for Drive folders plan google.drive.create_folder/get_file.
- Always include a final verification/read-back step; the agent must not complete without it.
- If the goal sends/publishes externally or is destructive, include an explicit approval step before that action.
- Mark steps that need a connection that may be missing.
Respond with ONLY minified JSON: {"steps":[{"title","instruction","required":true,"verificationHint"}]}`;

/**
 * Generate steps via the model, falling back to the deterministic heuristic on
 * any error (offline, no credits, bad JSON). Always returns a usable plan.
 */
export async function generateAutomationSteps(
  input: PlanInput,
  modelId: string,
  userId: string,
  isConnected: (refId: string) => boolean = () => true,
): Promise<PlanResult> {
  const missing = missingConnectionDeps(input.referencedContext, isConnected);
  try {
    const refLine = input.referencedContext.length ? `\nReferences: ${input.referencedContext.map(referenceSummary).join(', ')}` : '';
    const { content } = await callOpenRouterJson(
      [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: `Goal: ${input.prompt}${refLine}` },
      ],
      modelId, userId, true,
    );
    const parsed = extractJson(content);
    const raw = Array.isArray(parsed.steps) ? parsed.steps : [];
    if (raw.length === 0) throw new Error('empty plan');
    const steps: AutomationStep[] = raw.map((s, i) => {
      const x = s as Record<string, unknown>;
      const title = String(x.title ?? `Step ${i + 1}`).trim() || `Step ${i + 1}`;
      const instruction = typeof x.instruction === 'string' && x.instruction.trim()
        ? x.instruction.trim()
        : fallbackInstruction(title, input.prompt);
      return mkStep(i, title, instruction, i === 0 ? input.referencedContext : [], typeof x.verificationHint === 'string' ? x.verificationHint : undefined, x.required !== false);
    });
    // Guarantee a verification step exists.
    if (!steps.some((s) => /verif|read.?back|confirm/i.test(s.title))) {
      steps.push(mkStep(steps.length, 'Verify and read back', 'Read back the produced output and confirm it satisfies the goal before completing.', []));
    }
    return { steps, missingDependencies: missing };
  } catch {
    return { steps: heuristicSteps(input), missingDependencies: missing };
  }
}

function extractJson(raw: string): Record<string, unknown> {
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a === -1 || b === -1) return {};
  try { return JSON.parse(raw.slice(a, b + 1)); } catch { return {}; }
}
