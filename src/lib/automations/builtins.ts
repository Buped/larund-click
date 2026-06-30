import { resourceToReference } from '../mentions/types';
import { createAutomation, listAutomations, updateAutomation } from './store';
import type {
  Automation,
  AutomationSafetyPolicy,
  AutomationSetupPlan,
  AutomationStep,
  AutomationTrigger,
  CreateAutomationInput,
  VerificationCheck,
} from './types';

export const BUILT_IN_AUTOMATION_VERSION = 1;

type BuiltInAutomationDefinition = {
  packId: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  prompt: string;
  skillIds: string[];
  requiredConnectionIds: string[];
  referenceConnectionIds?: string[];
  steps: Array<Omit<AutomationStep, 'order' | 'referencedContext'> & { connectionRefs?: string[] }>;
  verificationChecklist: VerificationCheck[];
  safetyPolicy: AutomationSafetyPolicy;
  setupPlan?: AutomationSetupPlan;
};

const safeOfficePolicy: AutomationSafetyPolicy = {
  autonomyMode: 'safe_reads',
  externalWrite: 'ask',
  externalSend: 'ask',
  destructive: 'ask_strong',
  processExec: 'block',
  maxRuntimeMinutes: 20,
  maxToolCalls: 50,
};

const semiOfficePolicy: AutomationSafetyPolicy = {
  ...safeOfficePolicy,
  autonomyMode: 'semi',
};

function v(id: string, title: string, kind: VerificationCheck['kind'], description?: string): VerificationCheck {
  return { id, title, kind, description, required: true };
}

function setupPlan(
  status: AutomationSetupPlan['status'],
  bindingSpecs: AutomationSetupPlan['bindingSpecs'],
  steps: AutomationSetupPlan['steps'] = [],
  verificationChecklist: AutomationSetupPlan['verificationChecklist'] = [],
): AutomationSetupPlan {
  return { status, steps, verificationChecklist, bindingSpecs, bindings: [] };
}

export const BUILT_IN_AUTOMATION_DEFINITIONS: BuiltInAutomationDefinition[] = [
  {
    packId: 'email-triage-reply-drafts',
    name: 'Email triage and reply drafts',
    description: 'Review recent Gmail, classify priority, organize safely, and prepare verified reply drafts.',
    trigger: { kind: 'manual' },
    skillIds: ['email-ops'],
    requiredConnectionIds: ['google-workspace'],
    referenceConnectionIds: ['google-workspace'],
    prompt: [
      'Triage recent unread or important Gmail messages and prepare reply drafts where useful.',
      'Search Gmail with a bounded query, read full threads before deciding, classify messages by priority and required action, and create reply drafts in the original threads only.',
      'Do not send email. Ask before applying labels, archiving, or changing mailbox state. Finish with a concise summary of handled threads, draft IDs, uncertain items, and recommended next actions.',
    ].join('\n'),
    steps: [
      { id: 'email-search', title: 'Search inbox', instruction: 'Search Gmail for recent unread, starred, or important messages with a bounded query. Record message/thread ids and subjects.', required: true, verificationHint: 'Gmail search returned concrete message or thread ids.', connectionRefs: ['google-workspace'] },
      { id: 'email-read', title: 'Read threads', instruction: 'Read each relevant thread before classification. Do not infer intent from subject lines alone.', required: true, verificationHint: 'Full relevant thread content was read.', connectionRefs: ['google-workspace'] },
      { id: 'email-classify', title: 'Classify priority', instruction: 'Group messages into urgent reply, normal reply, waiting/no action, newsletter/noise, and uncertain. Preserve uncertainty instead of guessing.', required: true, verificationHint: 'Every selected thread has a clear classification.' },
      { id: 'email-organize', title: 'Prepare safe organization', instruction: 'Suggest labels or archive actions for identified message ids. Request approval before applying any mailbox change.', required: true, verificationHint: 'Mailbox writes were approved or left as suggestions.', connectionRefs: ['google-workspace'] },
      { id: 'email-drafts', title: 'Create reply drafts', instruction: 'Create editable Gmail reply drafts in the original threads for messages that need a response. Never send.', required: true, verificationHint: 'Reply draft ids were created and read back.', connectionRefs: ['google-workspace'] },
      { id: 'email-report', title: 'Report outcome', instruction: 'Summarize handled threads, draft ids, skipped/uncertain messages, and next actions.', required: true, verificationHint: 'Outcome summary names the verified drafts.' },
    ],
    verificationChecklist: [
      v('email-v-read', 'Gmail messages or threads were read', 'connection_read_back'),
      v('email-v-draft', 'Reply draft ids were created or explicitly reported as not needed', 'contains_text', 'The final output names draft ids or states why no draft was needed.'),
      v('email-v-nosend', 'No email was sent without approval', 'manual_review'),
    ],
    safetyPolicy: safeOfficePolicy,
  },
  {
    packId: 'daily-agenda-inbox-brief',
    name: 'Daily agenda and inbox brief',
    description: 'Create a daily agenda from Calendar and important Gmail context.',
    trigger: { kind: 'schedule', cron: '0 8 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    skillIds: ['email-ops', 'document-ops'],
    requiredConnectionIds: ['google-workspace'],
    referenceConnectionIds: ['google-workspace'],
    prompt: [
      'Every morning, read today\'s Google Calendar events and important unread Gmail messages, then prepare a concise agenda and inbox brief.',
      'Flag overlaps, tight gaps, urgent replies, missing prep, and open decisions. Write the brief to the linked chat when one exists; otherwise create a durable local markdown brief and read it back.',
      'Do not create, move, send, or delete anything.',
    ].join('\n'),
    steps: [
      { id: 'brief-calendar', title: 'Read calendar', instruction: 'Read today\'s Google Calendar events in time order, including title, time, attendees when available, and conferencing/location details.', required: true, verificationHint: 'Calendar events were read.', connectionRefs: ['google-workspace'] },
      { id: 'brief-email', title: 'Read important inbox items', instruction: 'Search and read urgent unread Gmail threads that may affect today. Keep the query bounded.', required: true, verificationHint: 'Important Gmail threads were read.', connectionRefs: ['google-workspace'] },
      { id: 'brief-analyze', title: 'Analyze day', instruction: 'Identify conflicts, tight gaps, prep needs, urgent replies, and decisions needed. Mark unknowns clearly.', required: true, verificationHint: 'Agenda risks and open items are listed.' },
      { id: 'brief-output', title: 'Write brief', instruction: 'Write a compact daily brief to the linked chat if available, otherwise to a local markdown file. Include agenda, inbox priorities, and next actions.', required: true, verificationHint: 'Brief was written.' },
      { id: 'brief-verify', title: 'Read back brief', instruction: 'Read back the produced brief or confirm the chat output content before completing.', required: true, verificationHint: 'Brief output was read back.' },
    ],
    verificationChecklist: [
      v('brief-v-conn', 'Calendar and/or Gmail data was read', 'connection_read_back'),
      v('brief-v-readback', 'Brief output was read back', 'file_read_back'),
    ],
    safetyPolicy: safeOfficePolicy,
  },
  {
    packId: 'document-search-summary-prep',
    name: 'Document search and summary prep',
    description: 'Find relevant local, Drive, or Notion documents and produce a verified summary.',
    trigger: { kind: 'manual' },
    skillIds: ['document-ops'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Search the referenced local folders/files, Google Drive, Google Docs, or Notion sources for the requested material.',
      'Read selected documents before summarizing, then prepare a verified markdown, Google Doc, DOCX, or PDF output depending on available tools and user context.',
      'If no sources are attached, ask for the missing source instead of inventing content.',
    ].join('\n'),
    steps: [
      { id: 'doc-resolve', title: 'Resolve sources', instruction: 'Identify the exact files, folders, Drive/Docs/Notion records, or URLs to use. Ask for source context if none is available.', required: true, verificationHint: 'Source list is explicit.' },
      { id: 'doc-read', title: 'Read selected documents', instruction: 'Read every selected source before summarizing. Capture title/path/url and relevant excerpts or structured facts.', required: true, verificationHint: 'Selected sources were read.' },
      { id: 'doc-summarize', title: 'Create summary', instruction: 'Summarize the material with key points, decisions, risks, dates, owners, and unknowns. Do not overclaim beyond the sources.', required: true, verificationHint: 'Summary is grounded in read sources.' },
      { id: 'doc-output', title: 'Prepare output', instruction: 'Write the requested durable output format, or default to a local markdown summary when no output target is provided.', required: true, verificationHint: 'Output artifact was created.' },
      { id: 'doc-verify', title: 'Read back output', instruction: 'Read the produced output and verify that it contains the expected sections and source references.', required: true, verificationHint: 'Output was read back.' },
    ],
    verificationChecklist: [
      v('doc-v-sources', 'Source list included', 'contains_text'),
      v('doc-v-output', 'Output was read back', 'file_read_back'),
    ],
    safetyPolicy: safeOfficePolicy,
  },
  {
    packId: 'invoice-folder-intake',
    name: 'Invoice folder intake',
    description: 'Watch an invoice folder, extract invoice fields, and append verified rows to a sheet or CSV.',
    trigger: { kind: 'folder_watch', path: '', pattern: '*.pdf', event: 'file_created_or_modified', debounceMs: 750, stableForMs: 1000, includeSubfolders: false },
    skillIds: ['document-ops', 'spreadsheet-refresh'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'When a new invoice file appears in the watched folder, read the trigger file and extract vendor, invoice number, date, due date, net amount, tax, gross amount, currency, and confidence.',
      'Append the result to the provisioned Google Sheet or local CSV output. If no output target is configured, ask for setup instead of losing the extracted data.',
      'Read the changed row back before completing.',
    ].join('\n'),
    setupPlan: setupPlan('pending', [
      { key: 'watched_invoice_folder', label: 'Watched invoice folder', kind: 'local_folder', required: true, description: 'Folder where invoice PDFs or images arrive.' },
      { key: 'invoice_output', label: 'Invoice output sheet or CSV', kind: 'other', required: true, description: 'Google Sheet, local CSV, or equivalent durable target for extracted invoice rows.' },
    ], [
      { id: 'invoice-setup-folder', title: 'Choose watched folder', instruction: 'Ask the user to choose or confirm the local invoice folder to watch, then verify that it is accessible.', referencedContext: [], required: true, order: 0, verificationHint: 'Watched folder path is verified.' },
      { id: 'invoice-setup-output', title: 'Choose output target', instruction: 'Create or validate a Google Sheet/local CSV output target with columns for vendor, invoice number, dates, amounts, currency, file path, and confidence. Read it back.', referencedContext: [], required: true, order: 1, verificationHint: 'Output target exists and was read back.' },
    ], [
      v('invoice-setup-v-folder', 'Watched folder was verified', 'file_read_back'),
      v('invoice-setup-v-output', 'Output target was read back', 'sheet_values_match'),
    ]),
    steps: [
      { id: 'invoice-read', title: 'Read trigger invoice', instruction: 'Use the trigger file path as the primary input. Read the invoice content with document/OCR tools where available.', required: true, verificationHint: 'Trigger invoice content was read.' },
      { id: 'invoice-extract', title: 'Extract fields', instruction: 'Extract vendor, invoice number, invoice date, due date, net, tax, gross, currency, and confidence. Mark missing fields explicitly.', required: true, verificationHint: 'Structured invoice fields are present.' },
      { id: 'invoice-append', title: 'Append row', instruction: 'Append one row to the configured sheet or CSV. Do not overwrite existing invoice data.', required: true, verificationHint: 'New row was written.' },
      { id: 'invoice-verify', title: 'Read changed row', instruction: 'Read back the appended row and compare key fields with the extracted invoice data.', required: true, verificationHint: 'Changed row matches extracted fields.' },
    ],
    verificationChecklist: [
      v('invoice-v-read', 'Invoice file was read', 'file_read_back'),
      v('invoice-v-sheet', 'Changed invoice row was read back', 'sheet_values_match'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
  {
    packId: 'spreadsheet-refresh-anomaly-summary',
    name: 'Spreadsheet refresh and anomaly summary',
    description: 'Refresh a local or Google spreadsheet and verify changed ranges.',
    trigger: { kind: 'manual' },
    skillIds: ['spreadsheet-refresh'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Refresh the referenced spreadsheet or table, profile headers/sample rows/formulas, apply the requested update narrowly, and flag anomalies such as duplicates, blanks, changed totals, or invalid dates.',
      'Read changed ranges back before completing. If no spreadsheet is referenced, ask for the target sheet/file.',
    ].join('\n'),
    steps: [
      { id: 'sheet-read', title: 'Read and profile sheet', instruction: 'Read headers, row count, sample rows, and formulas from the target local or Google spreadsheet.', required: true, verificationHint: 'Sheet was read before change.' },
      { id: 'sheet-plan', title: 'Plan narrow update', instruction: 'Decide whether the operation is append, update, refresh, or summary-only. Choose the narrowest safe target range.', required: true, verificationHint: 'Update range and method are explicit.' },
      { id: 'sheet-apply', title: 'Apply refresh', instruction: 'Apply the approved spreadsheet refresh/update. Ask before broad overwrites or destructive changes.', required: true, verificationHint: 'Spreadsheet update completed.' },
      { id: 'sheet-anomalies', title: 'Summarize anomalies', instruction: 'Detect duplicates, blanks, invalid values, formula issues, changed totals, and other unusual rows. Summarize clearly.', required: true, verificationHint: 'Anomaly summary produced.' },
      { id: 'sheet-verify', title: 'Read changed ranges', instruction: 'Read the affected ranges back and compare row/column counts or expected values.', required: true, verificationHint: 'Changed range was read back.' },
    ],
    verificationChecklist: [
      v('sheet-v-before', 'Sheet was read before change', 'sheet_values_match'),
      v('sheet-v-after', 'Changed range was read back', 'sheet_values_match'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
  {
    packId: 'meeting-notes-to-actions',
    name: 'Meeting notes to actions',
    description: 'Turn notes into action items, CRM/task updates, and follow-up email drafts.',
    trigger: { kind: 'manual' },
    skillIds: ['meeting-to-actions', 'email-ops'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Read meeting notes, transcript, or linked context, then extract decisions, action items, owners, due dates, blockers, and follow-up messages.',
      'Prepare CRM/task updates when the target records are unambiguous, and draft a follow-up email. Ask before writing CRM/task changes or sending externally.',
    ].join('\n'),
    steps: [
      { id: 'meeting-read', title: 'Read meeting notes', instruction: 'Read the provided notes/transcript/context. If missing, ask for the meeting source.', required: true, verificationHint: 'Meeting source was read.' },
      { id: 'meeting-extract', title: 'Extract actions', instruction: 'Extract decisions, owners, due dates, next steps, blockers, and unknowns. Use explicit unknown when not stated.', required: true, verificationHint: 'Action list includes owners/dates or unknowns.' },
      { id: 'meeting-crm', title: 'Prepare CRM or task updates', instruction: 'Search target CRM/task records if connected. Create/update only unambiguous records and only after approval.', required: true, verificationHint: 'CRM/task writes were approved and read back, or left as drafts.' },
      { id: 'meeting-email', title: 'Draft follow-up email', instruction: 'Prepare a follow-up email draft with decisions and next steps. Do not send without explicit approval.', required: true, verificationHint: 'Follow-up draft exists or draft text is produced.' },
      { id: 'meeting-verify', title: 'Verify outputs', instruction: 'Read back any created records/drafts and summarize what changed, what is pending approval, and what is uncertain.', required: true, verificationHint: 'Outputs were read back.' },
    ],
    verificationChecklist: [
      v('meeting-v-actions', 'Action items include owner/due date or explicit unknown', 'contains_text'),
      v('meeting-v-reads', 'Drafts or writes were read back', 'connection_read_back'),
      v('meeting-v-send', 'No follow-up was sent without approval', 'manual_review'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
  {
    packId: 'client-materials-pack',
    name: 'Client materials pack',
    description: 'Create a proposal, offer, report, or summary artifact from client context.',
    trigger: { kind: 'manual' },
    skillIds: ['client-materials', 'artifact-proposal', 'artifact-business-report'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Create a client-facing proposal, offer, report, or summary from the provided client brief, notes, email context, or folder.',
      'Read the context first, choose the right structure and audience tone, generate a durable artifact, verify it, and optionally prepare a delivery email draft. Do not send without approval.',
    ].join('\n'),
    steps: [
      { id: 'client-read', title: 'Read client context', instruction: 'Read the attached brief, notes, email context, or project folder. Ask for missing essentials instead of inventing.', required: true, verificationHint: 'Client context was read.' },
      { id: 'client-plan', title: 'Plan material', instruction: 'Choose artifact type, audience, sections, assumptions, missing inputs, and success criteria.', required: true, verificationHint: 'Material plan is explicit.' },
      { id: 'client-render', title: 'Generate artifact', instruction: 'Create the proposal/report/offer/summary as a durable artifact using the available artifact/document tools.', required: true, verificationHint: 'Artifact was created.' },
      { id: 'client-verify', title: 'Verify artifact', instruction: 'Run artifact verification or read the produced output back. Confirm expected client name, offer/report sections, and no placeholder text.', required: true, verificationHint: 'Artifact verification passed or issues are listed.' },
      { id: 'client-draft', title: 'Draft delivery', instruction: 'Optionally prepare a delivery email draft. Do not send externally without approval.', required: false, verificationHint: 'Delivery remains a draft unless approved.' },
    ],
    verificationChecklist: [
      v('client-v-source', 'Source context was read', 'file_read_back'),
      v('client-v-artifact', 'Artifact exists and was verified/read back', 'file_read_back'),
      v('client-v-send', 'Delivery email is draft-only unless approved', 'manual_review'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
  {
    packId: 'system-to-system-data-copy',
    name: 'System-to-system data copy',
    description: 'Copy data between tools with schema mapping, conflict checks, and target read-back.',
    trigger: { kind: 'manual' },
    skillIds: ['data-transfer-ops'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Copy data between a clearly identified source system and target system using schema mapping, conflict checks, and read-back verification.',
      'Read source and target schemas first. Ask for missing source/target details. Ask before external writes and before resolving conflicts.',
    ].join('\n'),
    steps: [
      { id: 'copy-source', title: 'Read source data and schema', instruction: 'Read source rows/records plus headers/properties. Record source count and key fields.', required: true, verificationHint: 'Source count and schema are known.' },
      { id: 'copy-target', title: 'Read target schema', instruction: 'Read target metadata, required fields, unique keys, and existing matching records where relevant.', required: true, verificationHint: 'Target schema and conflict keys are known.' },
      { id: 'copy-map', title: 'Map fields and conflicts', instruction: 'Build a field mapping and identify conflicts, missing required fields, duplicates, and transformations. Ask on conflict.', required: true, verificationHint: 'Mapping and conflict decisions are explicit.' },
      { id: 'copy-write', title: 'Write approved records', instruction: 'Write or append only approved mapped rows/records. Avoid destructive overwrite unless strongly approved.', required: true, verificationHint: 'Approved target write completed.' },
      { id: 'copy-verify', title: 'Read target back', instruction: 'Read target rows/records back and compare count plus key fields against the source/mapping.', required: true, verificationHint: 'Target read-back matches expected data.' },
    ],
    verificationChecklist: [
      v('copy-v-source', 'Source count is known', 'contains_text'),
      v('copy-v-target', 'Target read-back count/key fields match', 'connection_read_back'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
  {
    packId: 'workspace-maintenance-audit',
    name: 'Workspace maintenance audit',
    description: 'Audit Gmail, Drive, Notion, HubSpot, or workspace records safely and apply only approved changes.',
    trigger: { kind: 'schedule', cron: '0 9 * * 5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    skillIds: ['workspace-maintenance'],
    requiredConnectionIds: [],
    referenceConnectionIds: [],
    prompt: [
      'Run a weekly workspace maintenance audit over the connected or referenced workspace surfaces: Gmail, Drive, Notion, HubSpot, folders, or records.',
      'Start read-only, detect stale/duplicate/missing/misfiled items, produce a change list, request approval for writes, apply only approved changes, and read changed items back.',
    ].join('\n'),
    steps: [
      { id: 'maintenance-inventory', title: 'Read-only inventory', instruction: 'Inventory the selected workspace surface using read-only tools first. Do not change anything during inventory.', required: true, verificationHint: 'Read-only inventory completed.' },
      { id: 'maintenance-detect', title: 'Detect issues', instruction: 'Find stale, duplicate, missing, misfiled, incomplete, or risky items. Include severity and recommended action.', required: true, verificationHint: 'Issue list was produced.' },
      { id: 'maintenance-approve', title: 'Request approval', instruction: 'Prepare a precise change list and request approval before any write, move, archive, update, or delete.', required: true, verificationHint: 'Approval was requested for changes.' },
      { id: 'maintenance-apply', title: 'Apply approved changes', instruction: 'Apply only approved non-destructive changes. Block destructive changes unless strongly approved.', required: false, verificationHint: 'Approved changes were applied only.' },
      { id: 'maintenance-report', title: 'Verify and report', instruction: 'Read changed items back and produce an audit report with completed changes, skipped items, blockers, and next recommendations.', required: true, verificationHint: 'Audit report produced and changed items read back.' },
    ],
    verificationChecklist: [
      v('maintenance-v-audit', 'Read-only audit completed first', 'contains_text'),
      v('maintenance-v-report', 'Maintenance report produced', 'file_read_back'),
      v('maintenance-v-approved', 'Only approved writes were applied', 'manual_review'),
    ],
    safetyPolicy: semiOfficePolicy,
  },
];

export interface EnsureBuiltInAutomationsInput {
  userId: string;
  workspaceId?: string;
}

function connectionReference(providerId: string) {
  const label = providerId === 'google-workspace'
    ? 'Google'
    : providerId === 'hubspot'
      ? 'HubSpot'
      : providerId === 'notion'
        ? 'Notion'
        : providerId;
  return resourceToReference({ kind: 'connection', refId: providerId, label, available: false });
}

function toSteps(definition: BuiltInAutomationDefinition): AutomationStep[] {
  const refs = new Map((definition.referenceConnectionIds ?? []).map((id) => [id, connectionReference(id)]));
  return definition.steps.map((step, order) => ({
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    required: step.required,
    verificationHint: step.verificationHint,
    order,
    referencedContext: (step.connectionRefs ?? []).flatMap((id) => refs.get(id) ? [refs.get(id)!] : []),
  }));
}

function toCreateInput(definition: BuiltInAutomationDefinition, ctx: EnsureBuiltInAutomationsInput): CreateAutomationInput {
  const referencedContext = (definition.referenceConnectionIds ?? []).map(connectionReference);
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name: definition.name,
    description: definition.description,
    enabled: false,
    chatMode: 'none',
    chatVisibility: 'private_local',
    trigger: definition.trigger,
    taskTemplate: {
      prompt: definition.prompt,
      skillIds: definition.skillIds,
      requiredConnectionIds: definition.requiredConnectionIds,
    },
    autonomyMode: 'semi',
    approvalPolicy: {
      externalSendRequiresApproval: true,
      destructiveRequiresApproval: true,
    },
    prompt: definition.prompt,
    referencedContext,
    steps: toSteps(definition),
    verificationChecklist: definition.verificationChecklist,
    safetyPolicy: definition.safetyPolicy,
    setupPlan: definition.setupPlan,
    metadata: {
      isBuiltIn: true,
      builtInPackId: definition.packId,
      builtInVersion: BUILT_IN_AUTOMATION_VERSION,
      userCustomized: false,
    },
  };
}

export async function ensureBuiltInAutomations(ctx: EnsureBuiltInAutomationsInput): Promise<Automation[]> {
  const existing = await listAutomations({ userId: ctx.userId, workspaceId: ctx.workspaceId, includeDisabled: true });
  const byPackId = new Map(existing
    .filter((automation) => automation.metadata?.isBuiltIn === true && typeof automation.metadata?.builtInPackId === 'string')
    .map((automation) => [String(automation.metadata!.builtInPackId), automation]));

  const ensured: Automation[] = [];
  for (const definition of BUILT_IN_AUTOMATION_DEFINITIONS) {
    const current = byPackId.get(definition.packId);
    if (!current) {
      ensured.push(await createAutomation(toCreateInput(definition, ctx)));
      continue;
    }
    ensured.push(current);
    const customized = current.metadata?.userCustomized === true;
    const version = Number(current.metadata?.builtInVersion ?? 0);
    if (!customized && version < BUILT_IN_AUTOMATION_VERSION) {
      const input = toCreateInput(definition, ctx);
      await updateAutomation(current.id, {
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        taskTemplate: input.taskTemplate,
        prompt: input.prompt,
        referencedContext: input.referencedContext,
        steps: input.steps,
        verificationChecklist: input.verificationChecklist,
        safetyPolicy: input.safetyPolicy,
        setupPlan: input.setupPlan,
        metadata: input.metadata,
      });
    }
  }
  return ensured;
}
