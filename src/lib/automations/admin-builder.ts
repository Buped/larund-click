import { callOpenRouterJson } from '../openrouter';
import { listMentionResources } from '../mentions/resources';
import { resourceToReference, type MentionKind, type MentionResource, type ReferencedContext } from '../mentions/types';
import { referenceFromPath, referenceFromUrl } from '../references/local-picker';
import type { DocumentReference } from '../references/types';
import { normalizeConnectionProviderId } from '../connections/provider-aliases';
import { createAutomation } from './store';
import { checkAutomationDependencies, type DependencyReport } from './dependencies';
import { defaultSafetyPolicy, defaultVerification } from './migrate';
import { heuristicSteps } from './planner';
import { prepareAutomation, setupRequired } from './setup';
import { generateAdminSkillDrafts, type AdminSkillDraft } from './admin-skill-builder';
import type {
  Automation,
  AutomationSetupBindingKind,
  AutomationSetupBindingSpec,
  AutomationSetupPlan,
  AutomationSafetyPolicy,
  AutomationStep,
  AutomationTrigger,
  CreateAutomationInput,
  VerificationCheck,
} from './types';

const ADMIN_BUILDER_MODEL = 'google/gemini-3.1-flash-lite';

const EXTERNAL_OR_DESTRUCTIVE_RE = /\b(send|email|post|publish|tweet|message|notify|share|delete|remove|overwrite|archive|destructive|submit|deploy)\b/i;
const SEND_OR_PUBLISH_RE = /\b(send|email|post|publish|tweet|message|notify|share|submit)\b/i;
const GOOGLE_SHEET_RE = /\b(google\s*(sheet|sheets|spreadsheet|t[aá]bl[aá]zat)|sheets\.new)\b|docs\.google\.com\/spreadsheets/i;
const GOOGLE_DOC_RE = /\b(google\s*(doc|docs|document|dokumentum)|google\s*dokumentum)\b|docs\.google\.com\/document/i;
const DRIVE_FOLDER_RE = /\b(google\s*drive|drive\s*(folder|mappa)|google\s*(folder|mappa))\b|drive\.google\.com/i;
const LOCAL_OUTPUT_RE = /\b(save|write|export|output|produce|create|ment|mentsd|k[eé]sz[ií]ts|hozz l[eé]tre)\b[\s\S]{0,80}\b(file|folder|f[aá]jl|mappa|xlsx|csv|pdf|docx|txt|report|riport)\b/i;
const OUTPUT_VERB_RE = /\b(save|write|export|output|produce|create|ment|mentsd|k[eé]sz[ií]ts|hozz l[eé]tre)\b/i;

export interface AdminAutomationBuildInput {
  userId: string;
  projectId?: string;
  isAdmin: boolean;
  text: string;
  explicitReferences?: ReferencedContext[];
}

export interface AdminAutomationBuildResult {
  automation: Automation;
  dependencyReport: DependencyReport;
  warnings: string[];
  setupRunId?: string;
  skillDrafts: AdminSkillDraft[];
}

export interface AdminAutomationDraftJson {
  name?: string;
  description?: string;
  prompt?: string;
  trigger?: unknown;
  steps?: unknown;
  verificationChecklist?: unknown;
  safetyPolicy?: unknown;
  references?: unknown;
  infrastructurePlan?: unknown;
  setupPlan?: unknown;
  runPlan?: unknown;
  assumptions?: unknown;
  warnings?: unknown;
}

type InfrastructureStatus = 'existing' | 'create_on_run' | 'blocked';

interface InfrastructurePlanItem {
  resource: string;
  status: InfrastructureStatus;
  tool?: string;
  verification?: string;
}

let localId = 0;

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${(localId++).toString(36)}`;
}

function cleanText(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function makeName(text: string, draft: AdminAutomationDraftJson): string {
  const proposed = cleanText(draft.name, 80);
  if (proposed) return proposed;
  const firstSentence = text.split(/[.!?\n]/).map((part) => part.trim()).find(Boolean);
  if (firstSentence) return firstSentence.slice(0, 72);
  return 'Admin automation draft';
}

function fallbackDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function extractJson(raw: string): AdminAutomationDraftJson {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as AdminAutomationDraftJson : {};
  } catch {
    return {};
  }
}

function normalizeKind(value: unknown): MentionKind | undefined {
  const kind = typeof value === 'string' ? value : '';
  const allowed: MentionKind[] = ['app', 'skill', 'connection', 'mcp', 'memory', 'workflow', 'web_source', 'x_post', 'x_user', 'file', 'folder', 'drive_file', 'drive_folder'];
  return allowed.includes(kind as MentionKind) ? kind as MentionKind : undefined;
}

function referenceKey(ref: Pick<ReferencedContext, 'kind' | 'refId'>): string {
  const refId = ref.kind === 'connection' ? normalizeConnectionProviderId(ref.refId) : ref.refId;
  return `${ref.kind}:${refId}`.toLowerCase();
}

function resourceMatches(resource: MentionResource, wanted: { kind?: MentionKind; refId?: string; label?: string }): boolean {
  const refId = wanted.refId && wanted.kind === 'connection'
    ? normalizeConnectionProviderId(wanted.refId)
    : wanted.refId?.toLowerCase();
  const label = wanted.label?.toLowerCase();
  const candidateRefId = resource.kind === 'connection'
    ? normalizeConnectionProviderId(resource.refId)
    : resource.refId.toLowerCase();
  return (!wanted.kind || resource.kind === wanted.kind)
    && (!refId || candidateRefId === refId)
    && (!label || resource.label.toLowerCase() === label || candidateRefId === label);
}

function referenceFromDocument(doc: DocumentReference, kind: 'file' | 'folder' | 'web_source'): ReferencedContext {
  const refId = doc.url ?? doc.path ?? doc.id;
  return {
    id: nextId('ref'),
    kind,
    label: doc.label,
    refId,
    displayText: `@${doc.label}`,
    metadata: { documentReference: doc },
    insertedAt: new Date().toISOString(),
    status: 'available',
    resolvedAtSendTime: true,
  };
}

function pathKind(path: string): 'file' | 'folder' {
  if (/[\\/]$/.test(path)) return 'folder';
  const tail = path.split(/[\\/]/).pop() ?? '';
  return /\.[a-z0-9]{1,12}$/i.test(tail) ? 'file' : 'folder';
}

function extractPathReferences(text: string): ReferencedContext[] {
  const refs: ReferencedContext[] = [];
  const seen = new Set<string>();
  const pathMatches = text.match(/[A-Za-z]:[\\/][^\r\n"'<>|]+|\\\\[^\r\n"'<>|]+/g) ?? [];
  for (const raw of pathMatches) {
    const path = raw.trim().replace(/[),.;]+$/, '');
    if (!path || seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    const kind = pathKind(path);
    refs.push(referenceFromDocument(referenceFromPath(path, kind), kind));
  }
  const urlMatches = text.match(/\bhttps?:\/\/[^\s"'<>]+/g) ?? [];
  for (const raw of urlMatches) {
    const url = raw.trim().replace(/[),.;]+$/, '');
    if (!url || seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    refs.push(referenceFromDocument(referenceFromUrl(url), 'web_source'));
  }
  return refs;
}

function outputPathKeys(text: string): Set<string> {
  const out = new Set<string>();
  const pathMatches = text.match(/[A-Za-z]:[\\/][^\r\n"'<>|]+|\\\\[^\r\n"'<>|]+/g) ?? [];
  for (const raw of pathMatches) {
    const path = raw.trim().replace(/[),.;]+$/, '');
    const index = text.indexOf(raw);
    const before = index >= 0 ? text.slice(Math.max(0, index - 100), index) : '';
    if (OUTPUT_VERB_RE.test(before)) out.add(path.toLowerCase());
  }
  return out;
}

function resolveReferences(draft: AdminAutomationDraftJson, catalog: MentionResource[], explicit: ReferencedContext[], text: string): ReferencedContext[] {
  const refs: ReferencedContext[] = [];
  const seen = new Set<string>();
  const outputPaths = outputPathKeys(text);
  const add = (ref: ReferencedContext) => {
    if ((ref.kind === 'file' || ref.kind === 'folder') && outputPaths.has(ref.refId.toLowerCase())) return;
    const key = referenceKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  explicit.forEach(add);
  extractPathReferences(text).forEach(add);

  const rawRefs = Array.isArray(draft.references) ? draft.references : [];
  for (const raw of rawRefs) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const kind = normalizeKind(item.kind);
    const refId = cleanText(item.refId ?? item.id, 180);
    const label = cleanText(item.label ?? item.name, 180);
    const resource = catalog.find((candidate) => resourceMatches(candidate, { kind, refId, label }));
    if (resource) add(resourceToReference(resource));
  }

  const lowerText = text.toLowerCase();
  for (const resource of catalog) {
    const label = resource.label.toLowerCase();
    if (label.length >= 4 && lowerText.includes(label)) add(resourceToReference(resource));
  }

  return refs;
}

function makeConnectionReference(providerId: string, label: string, available = false, detail?: string): ReferencedContext {
  return resourceToReference({ kind: 'connection', refId: providerId, label, available, detail });
}

function hasConnectionRef(refs: ReferencedContext[], providerId: string): boolean {
  const canonical = normalizeConnectionProviderId(providerId);
  return refs.some((ref) => ref.kind === 'connection' && normalizeConnectionProviderId(ref.refId) === canonical);
}

function findConnectionResource(catalog: MentionResource[], providerId: string): MentionResource | undefined {
  const canonical = normalizeConnectionProviderId(providerId);
  return catalog.find((resource) => resource.kind === 'connection' && normalizeConnectionProviderId(resource.refId) === canonical);
}

function ensureInfrastructureReferences(text: string, prompt: string, refs: ReferencedContext[], catalog: MentionResource[]): ReferencedContext[] {
  const combined = `${text}\n${prompt}`;
  if (!needsGoogleWorkspace(combined) || hasConnectionRef(refs, 'google-workspace')) return refs;
  const google = findConnectionResource(catalog, 'google-workspace');
  return [
    ...refs,
    google
      ? resourceToReference(google)
      : makeConnectionReference('google-workspace', 'Google', false, 'Required for Google Workspace tools'),
  ];
}

function normalizeTrigger(raw: unknown): AutomationTrigger {
  if (!raw || typeof raw !== 'object') return { kind: 'manual' };
  const data = raw as Record<string, unknown>;
  const kind = String(data.kind ?? data.type ?? '').toLowerCase();

  if (kind === 'folder_watch' || kind === 'folder-watch' || kind === 'folder') {
    const path = cleanText(data.path ?? data.folderPath, 500) ?? '';
    return {
      kind: 'folder_watch',
      path,
      pattern: cleanText(data.pattern, 80),
      event: data.event === 'file_created' || data.event === 'file_modified' || data.event === 'file_created_or_modified' ? data.event : 'file_created_or_modified',
      debounceMs: safePositiveInt(data.debounceMs, 500),
      stableForMs: safePositiveInt(data.stableForMs, 1000),
      includeSubfolders: data.includeSubfolders === true,
      pollIntervalMs: safePositiveInt(data.pollIntervalMs, 30_000),
    };
  }

  if (kind === 'schedule' || kind === 'cron' || kind === 'interval' || kind === 'daily' || kind === 'weekly' || kind === 'monthly') {
    const cron = cleanText(data.cron, 80);
    const intervalMinutes = safePositiveInt(data.intervalMinutes ?? data.minutes, 0);
    if (cron || intervalMinutes > 0) {
      return {
        kind: 'schedule',
        cron,
        intervalMinutes: intervalMinutes || undefined,
        timezone: cleanText(data.timezone, 80) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
  }

  if (kind === 'connection_event' || kind === 'connection-event') {
    const providerId = cleanText(data.providerId ?? data.provider, 80);
    const eventType = cleanText(data.eventType ?? data.event, 80);
    if (providerId && eventType) return { kind: 'connection_event', providerId, eventType, filter: objectOrUndefined(data.filter) };
  }

  return { kind: 'manual' };
}

function safePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeStepItems(raw: unknown, refs: ReferencedContext[]): AutomationStep[] {
  const items = Array.isArray(raw) ? raw : [];
  const steps: AutomationStep[] = [];
  items.forEach((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object') return;
    const data = rawStep as Record<string, unknown>;
    const title = cleanText(data.title, 100) ?? `Step ${index + 1}`;
    const instruction = cleanText(data.instruction ?? data.prompt ?? data.description, 1200);
    if (!instruction) return;
    steps.push({
      id: cleanText(data.id, 80) ?? nextId('step'),
      title,
      instruction,
      referencedContext: index === 0 ? refs : [],
      required: data.required !== false,
      order: index,
      verificationHint: cleanText(data.verificationHint ?? data.verify, 300),
    });
  });
  return steps.map((step, index) => ({ ...step, id: step.id || nextId('step'), order: index }));
}

function normalizeSteps(raw: unknown, prompt: string, refs: ReferencedContext[]): AutomationStep[] {
  const steps = normalizeStepItems(raw, refs);
  const out = steps.length > 0 ? steps : heuristicSteps({ prompt, referencedContext: refs });
  return out.map((step, index) => ({ ...step, id: step.id || nextId('step'), order: index }));
}

function normalizeInfrastructurePlan(raw: unknown): InfrastructurePlanItem[] {
  const items = Array.isArray(raw) ? raw : [];
  const out: InfrastructurePlanItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    const resource = cleanText(data.resource ?? data.name, 160);
    const status = cleanText(data.status, 40);
    if (!resource || status !== 'existing' && status !== 'create_on_run' && status !== 'blocked') continue;
    out.push({
      resource,
      status,
      tool: cleanText(data.tool, 120),
      verification: cleanText(data.verification, 240),
    });
  }
  return out;
}

function objectField(raw: unknown, key: string): unknown {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}

function normalizeBindingKind(value: unknown): AutomationSetupBindingKind | undefined {
  const kind = typeof value === 'string' ? value : '';
  const allowed: AutomationSetupBindingKind[] = ['google_sheet', 'google_doc', 'drive_folder', 'local_folder', 'local_file', 'url', 'other'];
  return allowed.includes(kind as AutomationSetupBindingKind) ? kind as AutomationSetupBindingKind : undefined;
}

function normalizeBindingSpecs(raw: unknown): AutomationSetupBindingSpec[] {
  const items = Array.isArray(raw) ? raw : [];
  const specs: AutomationSetupBindingSpec[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    const key = cleanText(data.key ?? data.id ?? data.name, 80);
    const label = cleanText(data.label ?? data.name ?? data.key, 120);
    const kind = normalizeBindingKind(data.kind ?? data.type);
    if (!key || !label || !kind) continue;
    specs.push({
      key,
      label,
      kind,
      required: data.required !== false,
      description: cleanText(data.description, 300),
    });
  }
  return specs;
}

function addBindingSpec(specs: AutomationSetupBindingSpec[], spec: AutomationSetupBindingSpec): void {
  if (specs.some((item) => item.key === spec.key || item.kind === spec.kind && item.label === spec.label)) return;
  specs.push(spec);
}

function inferBindingSpecs(prompt: string, refs: ReferencedContext[], infrastructurePlan: InfrastructurePlanItem[]): AutomationSetupBindingSpec[] {
  const specs: AutomationSetupBindingSpec[] = [];
  const infraText = infrastructurePlan.map((item) => `${item.resource} ${item.status} ${item.tool ?? ''}`).join('\n');
  const combined = `${prompt}\n${infraText}`;
  if (GOOGLE_SHEET_RE.test(combined)) addBindingSpec(specs, { key: 'target_sheet', label: 'Target Google Sheet', kind: 'google_sheet', required: true, description: 'Reusable spreadsheet created or validated during setup.' });
  if (GOOGLE_DOC_RE.test(combined)) addBindingSpec(specs, { key: 'target_doc', label: 'Target Google Doc', kind: 'google_doc', required: true, description: 'Reusable document created or validated during setup.' });
  if (DRIVE_FOLDER_RE.test(combined)) addBindingSpec(specs, { key: 'target_drive_folder', label: 'Target Drive folder', kind: 'drive_folder', required: true, description: 'Reusable Drive folder created or validated during setup.' });
  if (LOCAL_OUTPUT_RE.test(combined) || outputPathKeys(combined).size > 0 || refs.some((ref) => ref.kind === 'folder')) {
    addBindingSpec(specs, { key: 'local_output', label: 'Local output location', kind: 'local_file', required: false, description: 'Reusable local output path prepared during setup when needed.' });
  }
  return specs;
}

function normalizeVerification(raw: unknown): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const items = Array.isArray(raw) ? raw : [];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const data = item as Record<string, unknown>;
    const title = cleanText(data.title, 140) ?? `Verification ${index + 1}`;
    checks.push({
      id: cleanText(data.id, 80) ?? nextId('v'),
      title,
      description: cleanText(data.description, 400),
      kind: isVerificationKind(data.kind) ? data.kind : 'file_read_back',
      required: data.required !== false,
      config: objectOrUndefined(data.config),
    });
  });

  if (!checks.some((check) => check.kind === 'file_read_back' || /read.?back|verify|confirm/i.test(check.title))) {
    checks.push(...defaultVerification());
  }
  return checks.length ? checks : defaultVerification();
}

function isVerificationKind(value: unknown): value is VerificationCheck['kind'] {
  return typeof value === 'string'
    && ['file_exists', 'file_read_back', 'connection_read_back', 'sheet_values_match', 'doc_read_back', 'contains_text', 'manual_review', 'custom'].includes(value);
}

function stringList(raw: unknown, maxItems = 8): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => cleanText(value, 240)).filter((value): value is string => Boolean(value)).slice(0, maxItems);
}

function needsGoogleWorkspace(text: string): boolean {
  return GOOGLE_SHEET_RE.test(text) || GOOGLE_DOC_RE.test(text) || DRIVE_FOLDER_RE.test(text);
}

function hasExistingGoogleSheetRef(text: string, refs: ReferencedContext[]): boolean {
  return GOOGLE_SHEET_RE.test(text) && /docs\.google\.com\/spreadsheets\/d\/|spreadsheets\/d\/[a-zA-Z0-9_-]+/i.test(text)
    || refs.some((ref) => /docs\.google\.com\/spreadsheets\/d\/|spreadsheets\/d\/[a-zA-Z0-9_-]+/i.test(ref.refId));
}

function hasExistingGoogleDocRef(text: string, refs: ReferencedContext[]): boolean {
  return GOOGLE_DOC_RE.test(text) && /docs\.google\.com\/document\/d\/|document\/d\/[a-zA-Z0-9_-]+/i.test(text)
    || refs.some((ref) => /docs\.google\.com\/document\/d\/|document\/d\/[a-zA-Z0-9_-]+/i.test(ref.refId));
}

function hasExplicitDriveFolderRef(text: string, refs: ReferencedContext[]): boolean {
  return DRIVE_FOLDER_RE.test(text) && /drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+/i.test(text)
    || refs.some((ref) => ref.kind === 'drive_folder' || /drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+/i.test(ref.refId));
}

function hasStep(steps: AutomationStep[], pattern: RegExp): boolean {
  return steps.some((step) => pattern.test(`${step.title}\n${step.instruction}\n${step.verificationHint ?? ''}`));
}

function createStep(title: string, instruction: string, refs: ReferencedContext[], verificationHint: string): AutomationStep {
  return {
    id: nextId('step'),
    title,
    instruction,
    referencedContext: refs,
    required: true,
    order: 0,
    verificationHint,
  };
}

function referencesForProvider(refs: ReferencedContext[], providerId: string): ReferencedContext[] {
  const canonical = normalizeConnectionProviderId(providerId);
  return refs.filter((ref) => ref.kind === 'connection' && normalizeConnectionProviderId(ref.refId) === canonical);
}

function ensureInfrastructureSteps(
  steps: AutomationStep[],
  prompt: string,
  refs: ReferencedContext[],
  infrastructurePlan: InfrastructurePlanItem[],
): AutomationStep[] {
  const prep: AutomationStep[] = [];
  const googleRefs = referencesForProvider(refs, 'google-workspace');
  const infraText = infrastructurePlan.map((item) => `${item.resource} ${item.status} ${item.tool ?? ''}`).join('\n');
  const combined = `${prompt}\n${infraText}`;

  if (GOOGLE_SHEET_RE.test(combined)) {
    if (hasExistingGoogleSheetRef(combined, refs)) {
      if (!hasStep(steps, /google\.sheets\.(get_metadata|read_values)|validate existing google sheet|read existing google sheet/i)) {
        prep.push(createStep(
          'Validate Google Sheet',
          'Use the provided Google Sheet URL or spreadsheetId as an existing target. Before writing or reading business data, call google.sheets.get_metadata or google.sheets.read_values to prove the sheet exists and is accessible. If it is not accessible, report the blocker instead of inventing a replacement.',
          googleRefs,
          'Existing Google Sheet metadata or values were read successfully.',
        ));
      }
    } else if (!hasStep(steps, /google\.sheets\.create|create (a )?google sheet|google sheet.*create/i)) {
      prep.push(createStep(
        'Create Google Sheet infrastructure',
        'No concrete Google Sheet was provided. Create the required Google Sheet with google.sheets.create, choose a clear business title, write the needed headers/template rows with google.sheets.write_values, then call google.sheets.read_values. Keep the spreadsheetId and URL from the tool result in the run evidence and use that same sheet for all later steps.',
        googleRefs,
        'Google Sheet was created, initialized, and read back with expected headers/template rows.',
      ));
    }
  }

  if (GOOGLE_DOC_RE.test(combined)) {
    if (hasExistingGoogleDocRef(combined, refs)) {
      if (!hasStep(steps, /google\.docs\.(get_metadata|read)|validate existing google doc|read existing google doc/i)) {
        prep.push(createStep(
          'Validate Google Doc',
          'Use the provided Google Doc URL or documentId as an existing target. Before updating it, call google.docs.get_metadata or google.docs.read to prove the document exists and is accessible. If it is not accessible, report the blocker instead of inventing a replacement.',
          googleRefs,
          'Existing Google Doc metadata or contents were read successfully.',
        ));
      }
    } else if (!hasStep(steps, /google\.docs\.create|create (a )?google doc|google doc.*create/i)) {
      prep.push(createStep(
        'Create Google Doc infrastructure',
        'No concrete Google Doc was provided. Create the required Google Doc with google.docs.create, insert the initial section structure/template with google.docs.insert_text or google.docs.batch_update, then call google.docs.read. Keep the documentId and URL from the tool result in the run evidence and use that same doc for all later steps.',
        googleRefs,
        'Google Doc was created, initialized, and read back.',
      ));
    }
  }

  if (DRIVE_FOLDER_RE.test(combined)) {
    if (hasExplicitDriveFolderRef(combined, refs)) {
      if (!hasStep(steps, /google\.drive\.get_file|validate existing drive folder|read existing drive folder/i)) {
        prep.push(createStep(
          'Validate Drive folder',
          'Use the provided Drive folder URL or folderId as an existing target. Call google.drive.get_file to prove the folder exists and is accessible before writing files into it.',
          googleRefs,
          'Existing Drive folder metadata was read successfully.',
        ));
      }
    } else if (!hasStep(steps, /google\.drive\.create_folder|create (a )?(drive|google drive) folder|drive folder.*create/i)) {
      prep.push(createStep(
        'Create Drive folder infrastructure',
        'No concrete Drive folder was provided. Create the required folder with google.drive.create_folder, choose a clear business name, and verify it with google.drive.get_file before storing outputs there. Keep the folderId and URL in the run evidence for later steps.',
        googleRefs,
        'Drive folder was created and metadata read-back succeeded.',
      ));
    }
  }

  if ((LOCAL_OUTPUT_RE.test(combined) || outputPathKeys(combined).size > 0) && !hasStep(steps, /file\.(mkdir|write|exists|read)|doc\.write|sheet\.write|artifact\.render/i)) {
    prep.push(createStep(
      'Prepare local output infrastructure',
      'If the workflow needs a local output file or folder, create the parent folder with file.mkdir when needed, create the durable output with the appropriate file/document/sheet/artifact tool, and verify it with file.exists plus a read-back. Do not treat a missing output path as a missing input.',
      refs.filter((ref) => ref.kind !== 'connection'),
      'Local output path exists and the produced content was read back.',
    ));
  }

  if (!prep.length) return steps.map((step, index) => ({ ...step, order: index }));
  return [...prep, ...steps].map((step, index) => ({ ...step, order: index }));
}

function addVerification(checks: VerificationCheck[], kind: VerificationCheck['kind'], title: string, description?: string): void {
  if (checks.some((check) => check.kind === kind || check.title.toLowerCase() === title.toLowerCase())) return;
  checks.push({
    id: nextId('v'),
    title,
    description,
    kind,
    required: true,
  });
}

function enhanceVerification(
  checks: VerificationCheck[],
  prompt: string,
  refs: ReferencedContext[],
  infrastructurePlan: InfrastructurePlanItem[],
): VerificationCheck[] {
  const out = [...checks];
  const combined = `${prompt}\n${infrastructurePlan.map((item) => `${item.resource} ${item.tool ?? ''}`).join('\n')}`;
  if (needsGoogleWorkspace(combined) || hasConnectionRef(refs, 'google-workspace')) {
    addVerification(out, 'connection_read_back', 'Google Workspace connection call succeeded', 'A required Google Workspace API call returned usable data.');
  }
  if (GOOGLE_SHEET_RE.test(combined)) {
    addVerification(out, 'sheet_values_match', 'Google Sheet was read back with expected structure', 'The target Google Sheet exists and the expected headers or rows were read back.');
  }
  if (GOOGLE_DOC_RE.test(combined)) {
    addVerification(out, 'doc_read_back', 'Google Doc was read back', 'The target Google Doc exists and its content was read back.');
  }
  if (DRIVE_FOLDER_RE.test(combined)) {
    addVerification(out, 'connection_read_back', 'Drive folder metadata was read back', 'The Drive folder create or metadata call succeeded.');
  }
  if (LOCAL_OUTPUT_RE.test(combined) || outputPathKeys(combined).size > 0) {
    addVerification(out, 'file_exists', 'Local output exists', 'The created local file or folder exists before completion.');
    addVerification(out, 'file_read_back', 'Local output was read back', 'The produced local output was read back before completion.');
  }
  return out;
}

function stripSetupStepsFromRun(steps: AutomationStep[]): AutomationStep[] {
  const setupPattern = /google\.sheets\.create|google\.docs\.create|google\.drive\.create_folder|create google sheet infrastructure|create google doc infrastructure|create drive folder infrastructure|prepare local output infrastructure|validate google sheet|validate google doc|validate drive folder/i;
  const filtered = steps.filter((step) => !setupPattern.test(`${step.title}\n${step.instruction}`));
  return (filtered.length ? filtered : steps).map((step, index) => ({ ...step, order: index }));
}

function normalizeSetupVerification(raw: unknown, setupSteps: AutomationStep[], prompt: string, refs: ReferencedContext[], infrastructurePlan: InfrastructurePlanItem[]): VerificationCheck[] {
  if (!setupSteps.length) return [];
  return enhanceVerification(normalizeVerification(raw), prompt, refs, infrastructurePlan);
}

function buildSetupPlan(
  draft: AdminAutomationDraftJson,
  prompt: string,
  refs: ReferencedContext[],
  infrastructurePlan: InfrastructurePlanItem[],
): AutomationSetupPlan {
  const rawSetup = draft.setupPlan;
  const rawRequired = objectField(rawSetup, 'required');
  const setupStepsFromModel = normalizeStepItems(objectField(rawSetup, 'steps'), refs);
  const deterministicSetupSteps = ensureInfrastructureSteps([], prompt, refs, infrastructurePlan);
  const setupSteps = (setupStepsFromModel.length ? setupStepsFromModel : deterministicSetupSteps).map((step, index) => ({ ...step, order: index }));
  const bindingSpecs = [
    ...normalizeBindingSpecs(objectField(rawSetup, 'bindingSpecs') ?? objectField(rawSetup, 'bindings')),
  ];
  for (const spec of inferBindingSpecs(prompt, refs, infrastructurePlan)) addBindingSpec(bindingSpecs, spec);
  const required = rawRequired === true || setupSteps.length > 0 || bindingSpecs.some((spec) => spec.required !== false);
  return {
    status: required ? 'pending' : 'not_required',
    steps: required ? setupSteps : [],
    verificationChecklist: required ? normalizeSetupVerification(objectField(rawSetup, 'verificationChecklist'), setupSteps, prompt, refs, infrastructurePlan) : [],
    bindingSpecs: required ? bindingSpecs : [],
    bindings: [],
  };
}

function normalizeSafetyPolicy(raw: unknown, prompt: string): AutomationSafetyPolicy {
  const base = defaultSafetyPolicy('semi');
  const data = raw && typeof raw === 'object' ? raw as Partial<AutomationSafetyPolicy> : {};
  const sends = SEND_OR_PUBLISH_RE.test(prompt);
  const destructive = /\b(delete|remove|overwrite|destroy|drop|truncate)\b/i.test(prompt);
  const externalWrite = sends || destructive
    ? 'ask'
    : data.externalWrite === 'ask' || data.externalWrite === 'block'
      ? data.externalWrite
      : 'allow';
  return {
    autonomyMode: data.autonomyMode === 'manual' || data.autonomyMode === 'safe_reads' || data.autonomyMode === 'semi' ? data.autonomyMode : base.autonomyMode,
    externalWrite,
    externalSend: sends ? 'ask' : data.externalSend === 'block' ? 'block' : 'ask',
    destructive: destructive ? 'ask_strong' : data.destructive === 'block' ? 'block' : 'ask_strong',
    processExec: data.processExec === 'block' ? 'block' : 'ask',
    maxRuntimeMinutes: safeOptionalPositiveInt(data.maxRuntimeMinutes) ?? base.maxRuntimeMinutes,
    maxToolCalls: safeOptionalPositiveInt(data.maxToolCalls) ?? base.maxToolCalls,
  };
}

function safeOptionalPositiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function ensureApprovalStep(steps: AutomationStep[], prompt: string): AutomationStep[] {
  if (!EXTERNAL_OR_DESTRUCTIVE_RE.test(prompt)) return steps;
  if (steps.some((step) => /approval|approve|jóváhagy|confirm/i.test(`${step.title} ${step.instruction}`))) return steps;
  const insertAt = Math.max(steps.length - 1, 0);
  const approval: AutomationStep = {
    id: nextId('step'),
    title: 'Request approval',
    instruction: 'Before any external send, publish, submit, overwrite, or destructive action, ask the admin for explicit approval and wait for the answer.',
    referencedContext: [],
    required: true,
    order: insertAt,
    verificationHint: 'Admin explicitly approved the external or destructive action.',
  };
  const next = [...steps.slice(0, insertAt), approval, ...steps.slice(insertAt)];
  return next.map((step, index) => ({ ...step, order: index }));
}

function summarizeCatalog(catalog: MentionResource[]): unknown[] {
  return catalog.slice(0, 120).map((resource) => ({
    kind: resource.kind,
    refId: resource.refId,
    label: resource.label,
    detail: resource.detail,
    available: resource.available,
  }));
}

async function draftWithModel(text: string, refs: ReferencedContext[], catalog: MentionResource[], userId: string): Promise<AdminAutomationDraftJson> {
  const { content } = await callOpenRouterJson(
    [
      {
        role: 'system',
        content: [
          'You are an automation architect for Larund. Convert admin workflow instructions into a complete automation that can run in the real world after it is tested/enabled.',
          'Think internally through exactly these stages before writing JSON: goal, trigger, inputs, existing resources, missing infrastructure, provisioning strategy, tool/API plan, data schema, safety/approval, verification.',
          'Return ONLY minified JSON with keys: name, description, prompt, trigger, references, setupPlan, runPlan, verificationChecklist, safetyPolicy, infrastructurePlan, assumptions, warnings.',
          'Triggers: manual, schedule with cron/intervalMinutes/timezone, connection_event, folder_watch.',
          'If no explicit trigger exists, use {"kind":"manual"}.',
          'Never pretend a Google Sheet, Google Doc, Drive folder, local file, or local folder exists unless the admin supplied a concrete URL/id/path or the resourceCatalog contains that exact resource.',
          'Split the workflow into setupPlan and runPlan. setupPlan is one-time provisioning/validation; runPlan is the recurring task that must not recreate setup infrastructure.',
          'If required infrastructure is missing but the needed connection/tool exists, put it in setupPlan with required steps that create it once, initialize its structure, save the resulting id/path/url in run evidence, and read it back. Do not put create-infrastructure steps in runPlan.',
          'For Google Sheets use google.sheets.create, google.sheets.write_values, then google.sheets.read_values. For existing Sheets validate with google.sheets.get_metadata or google.sheets.read_values before writing.',
          'For Google Docs use google.docs.create, insert_text or batch_update, then google.docs.read. For existing Docs validate with google.docs.get_metadata or google.docs.read.',
          'For Drive folders use google.drive.create_folder then google.drive.get_file; for existing folders validate metadata first.',
          'For local outputs create parent folders/files with file/document/sheet/artifact tools and verify file.exists plus read-back. Missing output paths are not missing input blockers.',
          'setupPlan shape: {"required":true,"steps":[...],"verificationChecklist":[...],"bindingSpecs":[{"key","label","kind","required":true}]}.',
          'runPlan shape: {"prompt":"...","steps":[...],"verificationChecklist":[...]}. runPlan steps may use provisioned bindings such as target_sheet or target_drive_folder but must not recreate them.',
          'Always include ordered concrete runPlan steps, a durable output, and at least one read-back verification.',
          'External send/publish/submit/destructive actions must keep approval/safety ask.',
          'Do not mention AI, assistant, draft source, or implementation provenance in user-visible fields.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          adminText: text,
          explicitReferences: refs.map((ref) => ({ kind: ref.kind, refId: ref.refId, label: ref.label })),
          resourceCatalog: summarizeCatalog(catalog),
        }),
      },
    ],
    ADMIN_BUILDER_MODEL,
    userId,
    true,
  );
  return extractJson(content);
}

export async function buildAutomationFromAdminText(input: AdminAutomationBuildInput): Promise<AdminAutomationBuildResult> {
  if (!input.isAdmin) throw new Error('admin_required');
  const text = input.text.trim();
  if (!text) throw new Error('empty_automation_text');

  const warnings: string[] = [];
  const catalog = await listMentionResources({ userId: input.userId, workspaceId: input.projectId }).catch((error) => {
    warnings.push(`Resource catalog unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [] as MentionResource[];
  });

  let draft: AdminAutomationDraftJson = {};
  try {
    draft = await draftWithModel(text, input.explicitReferences ?? [], catalog, input.userId);
  } catch (error) {
    warnings.push(`AI draft unavailable; deterministic fallback was used: ${error instanceof Error ? error.message : String(error)}`);
  }

  const name = makeName(text, draft);
  const description = cleanText(draft.description, 300) ?? fallbackDescription(text);
  const prompt = cleanText(objectField(draft.runPlan, 'prompt'), 4000) ?? cleanText(draft.prompt, 4000) ?? text;
  const refs = ensureInfrastructureReferences(text, prompt, resolveReferences(draft, catalog, input.explicitReferences ?? [], text), catalog);
  const trigger = normalizeTrigger(draft.trigger);
  const infrastructurePlan = normalizeInfrastructurePlan(draft.infrastructurePlan);
  const setupPlan = buildSetupPlan(draft, prompt, refs, infrastructurePlan);
  const baseSteps = normalizeSteps(objectField(draft.runPlan, 'steps') ?? draft.steps, prompt, refs);
  const steps = ensureApprovalStep(stripSetupStepsFromRun(baseSteps), prompt);
  const verificationChecklist = enhanceVerification(normalizeVerification(objectField(draft.runPlan, 'verificationChecklist') ?? draft.verificationChecklist), prompt, refs, []);
  const safetyPolicy = normalizeSafetyPolicy(draft.safetyPolicy, prompt);
  const requiredConnectionIds = refs.filter((ref) => ref.kind === 'connection').map((ref) => normalizeConnectionProviderId(ref.refId));
  const skillIds = refs.filter((ref) => ref.kind === 'skill').map((ref) => ref.refId);
  warnings.push(...stringList(draft.warnings).map((warning) => `AI builder warning: ${warning}`));
  warnings.push(...stringList(draft.assumptions).map((assumption) => `AI builder assumption: ${assumption}`));
  warnings.push(...infrastructurePlan.filter((item) => item.status === 'blocked').map((item) => `Infrastructure blocker: ${item.resource}${item.verification ? ` (${item.verification})` : ''}`));

  const createInput: CreateAutomationInput = {
    userId: input.userId,
    workspaceId: input.projectId,
    name,
    description,
    enabled: false,
    chatMode: 'create_new',
    chatVisibility: 'private_local',
    trigger,
    taskTemplate: {
      prompt,
      requiredConnectionIds: [...new Set(requiredConnectionIds)],
      skillIds: [...new Set(skillIds)],
    },
    autonomyMode: 'semi',
    approvalPolicy: {
      externalSendRequiresApproval: true,
      destructiveRequiresApproval: true,
      allowAlwaysSafeActions: true,
    },
    prompt,
    referencedContext: refs,
    steps,
    verificationChecklist,
    safetyPolicy,
    setupPlan,
  };

  const automation = await createAutomation(createInput);
  const dependencyReport = await checkAutomationDependencies(automation, { userId: input.userId, workspaceId: input.projectId });
  let setupRunId: string | undefined;
  if (dependencyReport.ok && setupRequired(setupPlan)) {
    try {
      const setup = await prepareAutomation(automation.id, { reason: 'admin_builder_setup' });
      setupRunId = setup.automationRunId;
    } catch (error) {
      warnings.push(`Setup was not started: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const preparedAutomation = await import('./store').then((store) => store.getAutomation(automation.id)).catch(() => null);
  const finalAutomation = preparedAutomation ?? automation;
  const skillBuild = await generateAdminSkillDrafts({
    userId: input.userId,
    workspaceId: input.projectId,
    adminText: text,
    automation: finalAutomation,
    availableConnectionIds: [...new Set(requiredConnectionIds)],
  });
  warnings.push(...skillBuild.warnings);
  return { automation: finalAutomation, dependencyReport, warnings, setupRunId, skillDrafts: skillBuild.drafts };
}
