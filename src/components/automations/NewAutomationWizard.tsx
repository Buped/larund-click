// Multi-step New Automation wizard: Goal → Trigger → Context → Steps → Verify →
// Safety → Test. Builds the full workflow definition (prompt + mentions + trigger
// + AI-planned steps + verification + safety) and saves it through the existing
// automation store; the test run uses the real runAutomation path (AutomationRun
// + TaskRun + evidence).

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../icons';
import { MentionEditor, MentionChip } from '../mentions/MentionEditor';
import type { ReferencedContext } from '../../lib/mentions/types';
import { listCatalogProviders } from '../../lib/connections/catalog';
import { isUsableConnectionRuntime, normalizeConnectionProviderId } from '../../lib/connections/provider-aliases';
import { createAutomation, getAutomation, updateAutomation } from '../../lib/automations/store';
import { runAutomation } from '../../lib/automations/runner';
import { isAutomationSetupReady, prepareAutomation, setupRequired } from '../../lib/automations/setup';
import { generateAutomationSteps } from '../../lib/automations/planner';
import { checkAutomationDependencies, type DependencyReport } from '../../lib/automations/dependencies';
import { defaultSafetyPolicy, normalizeSetupPlan } from '../../lib/automations/migrate';
import type { Automation, AutomationChatMode, AutomationSetupPlan, AutomationStep, AutomationTrigger, AutomationSafetyPolicy, VerificationCheck } from '../../lib/automations/types';
import { createAutomationLinkedChat, getLinkedChatTitle } from '../../lib/automations/chat-bridge';
import { ChatSessionPicker } from './ChatSessionPicker';
import { pickLocalFile, pickLocalFolder, pickUrlReference } from '../../lib/references/local-picker';
import type { DocumentReference } from '../../lib/references/types';
import { documentReferenceToMention } from '../mentions/mentionSerialization';
import { MODELS } from '../../constants/models';
import { card, btn, ghostBtn, dangerBtn, input, labelStyle, Badge } from '../pages/ui';
import { RunMonitor } from './RunMonitor';

const STEPS = ['Goal', 'Trigger', 'Context', 'Setup', 'Steps', 'Verify', 'Safety', 'Test'] as const;

type TriggerKind = 'manual' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron' | 'folder' | 'webhook';
type FolderEvent = NonNullable<Extract<AutomationTrigger, { kind: 'folder_watch' }>['event']>;
const TRIGGER_CARDS: Array<{ kind: TriggerKind; label: string; desc: string; disabled?: boolean }> = [
  { kind: 'manual', label: 'Manual', desc: 'Run only when you click Run now.' },
  { kind: 'interval', label: 'Every X', desc: 'Repeat on a fixed interval.' },
  { kind: 'daily', label: 'Daily', desc: 'Once a day at a set time.' },
  { kind: 'weekly', label: 'Weekly', desc: 'On a chosen weekday.' },
  { kind: 'monthly', label: 'Monthly', desc: 'On a day of the month.' },
  { kind: 'cron', label: 'Cron (advanced)', desc: 'A custom cron expression.' },
  { kind: 'folder', label: 'Folder watch', desc: 'When matching files appear.' },
  { kind: 'webhook', label: 'Webhook', desc: 'Coming later.', disabled: true },
];

const VERIFY_PRESETS: Array<{ kind: VerificationCheck['kind']; title: string }> = [
  { kind: 'file_exists', title: 'Output file exists' },
  { kind: 'file_read_back', title: 'Output was read back' },
  { kind: 'sheet_values_match', title: 'Google Sheet values were read back' },
  { kind: 'doc_read_back', title: 'Google Doc exists and can be read' },
  { kind: 'connection_read_back', title: 'Connection call succeeded' },
  { kind: 'contains_text', title: 'Summary contains required sections' },
  { kind: 'manual_review', title: 'Manual approval required before completion' },
];

export interface WizardInitial {
  name?: string;
  description?: string;
  prompt?: string;
  references?: ReferencedContext[];
  trigger?: AutomationTrigger;
  verification?: VerificationCheck[];
  steps?: AutomationStep[];
  setupPlan?: AutomationSetupPlan;
  safety?: AutomationSafetyPolicy;
  chatMode?: AutomationChatMode;
  linkedChatSessionId?: string;
}

export function NewAutomationWizard({ userId, workspaceId, initial, editId, onClose, onSaved, onOpenChat }: {
  userId: string; workspaceId?: string; initial?: WizardInitial; editId?: string; onClose: () => void; onSaved: () => void;
  onOpenChat?: (sessionId: string) => void;
}) {
  const isEditMode = Boolean(editId);
  const [step, setStep] = useState(0);
  // Highest step the user has reached. In create mode the top stepper unlocks up
  // to here (so you can jump back and forward across visited steps); in edit mode
  // every step is freely clickable (no Next-Next-Next to reach Safety). See §8.
  const [highestStep, setHighestStep] = useState(isEditMode ? STEPS.length - 1 : 0);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [references, setReferences] = useState<ReferencedContext[]>(initial?.references ?? []);

  // Chat linkage (§1–§8). Backfill: an existing automation with a linked session
  // was implicitly attached; without one it defaults to a dedicated chat.
  const [chatMode, setChatMode] = useState<AutomationChatMode>(
    initial?.chatMode ?? (initial?.linkedChatSessionId ? 'append_to_existing' : 'create_new'),
  );
  const [linkedChatSessionId, setLinkedChatSessionId] = useState<string | undefined>(initial?.linkedChatSessionId);
  const [linkedChatTitle, setLinkedChatTitle] = useState<string | undefined>(undefined);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  // Load the linked chat's title for display (edit mode / after attach).
  useEffect(() => {
    let alive = true;
    if (!linkedChatSessionId) { setLinkedChatTitle(undefined); return; }
    void getLinkedChatTitle(linkedChatSessionId).then((title) => {
      if (alive) setLinkedChatTitle(title ?? undefined);
    });
    return () => { alive = false; };
  }, [linkedChatSessionId]);

  // Trigger
  const initTrigger = initial?.trigger;
  const [tkind, setTkind] = useState<TriggerKind>(
    initTrigger?.kind === 'folder_watch' ? 'folder'
    : initTrigger?.kind === 'schedule' ? (initTrigger.intervalMinutes ? 'interval' : 'cron')
    : 'manual');
  const [intervalN, setIntervalN] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [time, setTime] = useState('08:00');
  const [weekday, setWeekday] = useState(1);
  const [dom, setDom] = useState(1);
  const [cron, setCron] = useState(initTrigger?.kind === 'schedule' ? (initTrigger.cron ?? '0 9 * * *') : '0 9 * * *');
  const [folderPath, setFolderPath] = useState(initTrigger?.kind === 'folder_watch' ? initTrigger.path : '');
  const [folderPattern, setFolderPattern] = useState(initTrigger?.kind === 'folder_watch' ? (initTrigger.pattern ?? '*.pdf') : '*.pdf');
  const [folderEvent, setFolderEvent] = useState<FolderEvent>(initTrigger?.kind === 'folder_watch' ? (initTrigger.event ?? 'file_created') : 'file_created');
  const [folderDebounceMs, setFolderDebounceMs] = useState(initTrigger?.kind === 'folder_watch' ? (initTrigger.debounceMs ?? 750) : 750);
  const [folderStableForMs, setFolderStableForMs] = useState(initTrigger?.kind === 'folder_watch' ? (initTrigger.stableForMs ?? 1000) : 1000);
  const [folderIncludeSubfolders, setFolderIncludeSubfolders] = useState(initTrigger?.kind === 'folder_watch' ? Boolean(initTrigger.includeSubfolders) : false);

  const [steps, setSteps] = useState<AutomationStep[]>(initial?.steps ?? []);
  const [setupPlan, setSetupPlan] = useState<AutomationSetupPlan>(normalizeSetupPlan(initial?.setupPlan));
  const [planning, setPlanning] = useState(false);
  const [verification, setVerification] = useState<VerificationCheck[]>(initial?.verification ?? [{ id: 'v-readback', title: 'Output was read back', kind: 'file_read_back', required: true }]);
  const [safety, setSafety] = useState<AutomationSafetyPolicy>(initial?.safety ?? defaultSafetyPolicy('semi'));

  const [savedId, setSavedId] = useState<string | null>(editId ?? null);
  const [runMsg, setRunMsg] = useState('');
  const [monitorRun, setMonitorRun] = useState<{ runId: string; automationName: string } | null>(null);
  const [deps, setDeps] = useState<DependencyReport | null>(null);
  const [folderTestMsg, setFolderTestMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const connectedIds = useMemo(
    () => new Set(listCatalogProviders({ userId, workspaceId }).filter((p) => isUsableConnectionRuntime(p.runtime)).map((p) => p.id)),
    [userId, workspaceId],
  );
  const isConnected = (id: string) => connectedIds.has(normalizeConnectionProviderId(id));

  function mergeReferences(existing: ReferencedContext[], incoming: ReferencedContext[]): ReferencedContext[] {
    const seen = new Set(existing.map((r) => `${r.kind}:${r.refId}`));
    const next = [...existing];
    for (const ref of incoming) {
      const key = `${ref.kind}:${ref.refId}`;
      if (!seen.has(key)) {
        seen.add(key);
        next.push(ref);
      }
    }
    return next;
  }

  function mentionsFromDocuments(docs: DocumentReference[]): ReferencedContext[] {
    return docs.map(documentReferenceToMention);
  }

  async function pickDocumentReferences(kind: 'file' | 'folder' | 'url'): Promise<ReferencedContext[]> {
    const docs = kind === 'file'
      ? await pickLocalFile()
      : kind === 'folder'
        ? await pickLocalFolder()
        : await pickUrlReference();
    return mentionsFromDocuments(docs);
  }

  async function addGlobalReference(kind: 'file' | 'folder' | 'url') {
    const refs = await pickDocumentReferences(kind);
    if (refs.length) setReferences((current) => mergeReferences(current, refs));
  }

  async function addStepReference(stepId: string, kind: 'file' | 'folder' | 'url') {
    const refs = await pickDocumentReferences(kind);
    if (!refs.length) return;
    setSteps((current) => current.map((item) => item.id === stepId
      ? { ...item, referencedContext: mergeReferences(item.referencedContext, refs) }
      : item));
  }

  async function chooseTriggerFolder() {
    const refs = mentionsFromDocuments(await pickLocalFolder());
    const folder = refs[0];
    const doc = folder?.metadata?.documentReference as DocumentReference | undefined;
    if (!doc?.path) return;
    setFolderPath(doc.path);
    setReferences((current) => mergeReferences(current, [folder]));
  }

  async function testFolderAccess() {
    setFolderTestMsg('Checking folder...');
    const report = await checkAutomationDependencies(draftAutomation(), { userId, workspaceId });
    setDeps(report);
    const folderIssue = [...report.blockers, ...report.warnings].find((issue) => issue.kind === 'trigger' || issue.refId === folderPath.trim());
    setFolderTestMsg(folderIssue ? folderIssue.message : 'Folder is accessible.');
  }

  function attachSession(sel: { sessionId: string; title: string }) {
    setChatMode('append_to_existing');
    setLinkedChatSessionId(sel.sessionId);
    setLinkedChatTitle(sel.title);
    setChatPickerOpen(false);
  }
  function detachChat() {
    setChatMode('none');
    setLinkedChatSessionId(undefined);
    setLinkedChatTitle(undefined);
  }
  async function createNowLinkedChat() {
    setCreatingChat(true);
    try {
      const created = await createAutomationLinkedChat({ automationName: name, projectId: workspaceId ?? null });
      if (created) {
        setChatMode('create_new');
        setLinkedChatSessionId(created.sessionId);
        setLinkedChatTitle(created.title);
      }
    } finally { setCreatingChat(false); }
  }
  function openLinkedChat() {
    if (linkedChatSessionId && onOpenChat) {
      onOpenChat(linkedChatSessionId);
      onClose();
    }
  }

  function buildTrigger(): AutomationTrigger {
    const [hh, mm] = time.split(':').map((x) => parseInt(x, 10) || 0);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    switch (tkind) {
      case 'manual': return { kind: 'manual' };
      case 'interval': return { kind: 'schedule', intervalMinutes: intervalN * (intervalUnit === 'minutes' ? 1 : intervalUnit === 'hours' ? 60 : 1440), timezone: tz };
      case 'daily': return { kind: 'schedule', cron: `${mm} ${hh} * * *`, timezone: tz };
      case 'weekly': return { kind: 'schedule', cron: `${mm} ${hh} * * ${weekday}`, timezone: tz };
      case 'monthly': return { kind: 'schedule', cron: `${mm} ${hh} ${dom} * *`, timezone: tz };
      case 'cron': return { kind: 'schedule', cron, timezone: tz };
      case 'folder': return {
        kind: 'folder_watch',
        path: folderPath.trim(),
        pattern: folderPattern.trim() || undefined,
        event: folderEvent,
        debounceMs: Math.max(0, folderDebounceMs || 0),
        stableForMs: Math.max(0, folderStableForMs || 0),
        includeSubfolders: folderIncludeSubfolders,
      };
      case 'webhook': return { kind: 'manual' };
    }
  }

  function draftAutomation(): Automation {
    const now = new Date().toISOString();
    return {
      id: savedId ?? 'draft', userId, workspaceId, name: name || 'Untitled automation',
      description,
      enabled: false, trigger: buildTrigger(),
      taskTemplate: { prompt, requiredConnectionIds: references.filter((r) => r.kind === 'connection').map((r) => normalizeConnectionProviderId(r.refId)), skillIds: references.filter((r) => r.kind === 'skill').map((r) => r.refId) },
      autonomyMode: safety.autonomyMode === 'manual' ? 'manual' : 'semi',
      approvalPolicy: { externalSendRequiresApproval: safety.externalSend === 'ask', destructiveRequiresApproval: safety.destructive === 'ask_strong' },
      status: 'disabled', prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety, setupPlan,
      chatMode, linkedChatSessionId, chatVisibility: 'private_local',
      createdAt: now, updatedAt: now,
    };
  }

  // Re-check dependencies whenever the visible context/trigger inputs change.
  useEffect(() => {
    if (step === 2) void checkAutomationDependencies(draftAutomation(), { userId, workspaceId }).then(setDeps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, references, steps, tkind, folderPath, folderPattern, folderEvent, folderIncludeSubfolders]);

  async function planSteps() {
    setPlanning(true);
    try {
      const modelId = MODELS.find((m) => m.id === 'core')?.openrouter_id ?? 'anthropic/claude-haiku-4-5';
      const res = await generateAutomationSteps({ prompt, referencedContext: references }, modelId, userId, isConnected);
      const split = splitSetupAndRunSteps(res.steps);
      if (split.setup.length) setSetupPlan((current) => ({ ...current, status: current.status === 'not_required' ? 'pending' : current.status, steps: split.setup, verificationChecklist: current.verificationChecklist.length ? current.verificationChecklist : verification }));
      setSteps(split.run);
    } finally { setPlanning(false); }
  }

  function addManualStep() {
    setSteps((s) => [...s, { id: `step-${Date.now()}`, title: 'New step', instruction: '', referencedContext: [], required: true, order: s.length }]);
  }
  function addSetupStep() {
    setSetupPlan((current) => ({
      ...current,
      status: current.status === 'not_required' ? 'pending' : current.status,
      steps: [...current.steps, { id: `setup-${Date.now()}`, title: 'New setup step', instruction: '', referencedContext: [], required: true, order: current.steps.length }],
    }));
  }
  function updateStep(id: string, patch: Partial<AutomationStep>) { setSteps((s) => s.map((x) => x.id === id ? { ...x, ...patch } : x)); }
  function updateSetupStep(id: string, patch: Partial<AutomationStep>) { setSetupPlan((current) => ({ ...current, steps: current.steps.map((x) => x.id === id ? { ...x, ...patch } : x) })); }
  function removeStep(id: string) { setSteps((s) => s.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i }))); }
  function removeSetupStep(id: string) { setSetupPlan((current) => ({ ...current, status: current.steps.length <= 1 && current.bindingSpecs.length === 0 ? 'not_required' : current.status, steps: current.steps.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i })) })); }
  function moveStep(id: string, dir: -1 | 1) {
    setSteps((s) => {
      const i = s.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s]; [next[i], next[j]] = [next[j], next[i]];
      return next.map((x, k) => ({ ...x, order: k }));
    });
  }

  function toggleVerify(preset: { kind: VerificationCheck['kind']; title: string }) {
    setVerification((v) => v.some((x) => x.kind === preset.kind && x.title === preset.title)
      ? v.filter((x) => !(x.kind === preset.kind && x.title === preset.title))
      : [...v, { id: `v-${preset.kind}-${Date.now()}`, title: preset.title, kind: preset.kind, required: true }]);
  }

  async function persist(enabled: boolean): Promise<string> {
    if (savedId) {
      const existing = await getAutomation(savedId);
      const metadata = existing?.metadata?.isBuiltIn === true
        ? { ...existing.metadata, userCustomized: true }
        : existing?.metadata;
      await updateAutomation(savedId, { name: name || 'Untitled automation', description, enabled, status: enabled ? 'active' : 'disabled', trigger: buildTrigger(), prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety, setupPlan, taskTemplate: draftAutomation().taskTemplate, chatMode, linkedChatSessionId, chatVisibility: 'private_local', metadata });
      return savedId;
    }
    const created = await createAutomation({ userId, workspaceId, name: name || 'Untitled automation', description, enabled, trigger: buildTrigger(), taskTemplate: draftAutomation().taskTemplate, prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety, setupPlan, chatMode, linkedChatSessionId, chatVisibility: 'private_local' });
    setSavedId(created.id);
    if (created.linkedChatSessionId && !linkedChatSessionId) setLinkedChatSessionId(created.linkedChatSessionId);
    return created.id;
  }

  async function testRun() {
    setBusy(true); setRunMsg('');
    try {
      const id = await persist(false);
      if (setupRequired(setupPlan) && !isAutomationSetupReady(draftAutomation())) {
        const setup = await prepareAutomation(id, { reason: 'test_setup' });
        if (setup.automationRunId) {
          setMonitorRun({ runId: setup.automationRunId, automationName: `${name || 'Untitled automation'} setup` });
          setRunMsg('Setup run started. After it completes, run the recurring test.');
          return;
        }
      }
      const r = await runAutomation(id, { reason: 'test_run' });
      setMonitorRun({ runId: r.automationRunId, automationName: name || 'Untitled automation' });
      setRunMsg(`Test run started — created automation run ${r.automationRunId.slice(0, 16)}… and a TaskRun with evidence. Open the Tasks page to watch it.`);
    } catch (e) {
      setRunMsg(`Test run failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally { setBusy(false); }
  }

  async function enableAndClose() {
    if (chatMode === 'append_to_existing' && !linkedChatSessionId) {
      setStep(0);
      setRunMsg('Choose a chat to attach, or switch the chat connection to Create new / None.');
      return;
    }
    setBusy(true);
    try {
      const report = await checkAutomationDependencies(draftAutomation(), { userId, workspaceId });
      setDeps(report);
      if (!report.ok) {
        setStep(2);
        setRunMsg('Fix the dependency blockers before enabling this automation.');
        return;
      }
      if (setupRequired(setupPlan) && !isAutomationSetupReady(draftAutomation())) {
        const id = await persist(false);
        const setup = await prepareAutomation(id, { reason: 'enable_setup' });
        if (setup.automationRunId) setMonitorRun({ runId: setup.automationRunId, automationName: `${name || 'Untitled automation'} setup` });
        setStep(STEPS.length - 1);
        setRunMsg('Setup must finish successfully before enabling this automation.');
        return;
      }
      await persist(true);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  }
  async function saveDraftAndClose() {
    setBusy(true);
    try { await persist(false); onSaved(); onClose(); } finally { setBusy(false); }
  }

  const canNext = step === 0 ? Boolean(name.trim() && prompt.trim()) : true;
  function canNavigateToStep(index: number): boolean {
    if (isEditMode) return true;
    return index <= highestStep;
  }
  function goToStep(index: number) {
    if (!canNavigateToStep(index)) return;
    setStep(index);
    setHighestStep((h) => Math.max(h, index));
  }
  // Mark steps that are missing required input so users can spot gaps even when
  // free-navigating in edit mode. Goal needs a name + prompt to be runnable.
  function stepHasIssue(index: number): boolean {
    if (index === 0) return !(name.trim() && prompt.trim());
    return false;
  }

  return (
    <>
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 100, background: 'rgba(0,0,0,.7)' }}>
      <div className="modal-pop" style={{ width: 720, maxWidth: '94vw', maxHeight: '92vh', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{isEditMode ? 'Edit automation' : 'New automation'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name.trim() || 'Configure a reusable workflow'}</div>
          </div>
          <button
            type="button"
            aria-label="Close automation editor"
            title="Close"
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(var(--ov-color),.04)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', display: 'grid', placeItems: 'center', flexShrink: 0 }}
          >
            <Icon name="x" size={16} stroke={2} />
          </button>
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => {
            const navigable = canNavigateToStep(i);
            const issue = stepHasIssue(i);
            return (
            <button key={s} onClick={() => goToStep(i)} disabled={!navigable} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: navigable ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: i === step ? 'var(--accent)' : issue ? 'rgba(240,170,60,.22)' : i < step ? 'rgba(62,207,142,.2)' : 'rgba(var(--ov-color),.07)', color: i === step ? 'var(--on-accent)' : issue ? 'var(--warning)' : i < step ? 'var(--success)' : 'var(--text-hint)' }}>{issue ? '!' : i < step ? '✓' : i + 1}</span>
              <span style={{ fontSize: 12, color: i === step ? 'var(--text-primary)' : 'var(--text-hint)', fontWeight: i === step ? 600 : 400 }}>{s}</span>
              {i < STEPS.length - 1 && <span style={{ width: 12, height: 1, background: 'var(--border)', margin: '0 2px' }} />}
            </button>
            );
          })}
        </div>

        <div className="scroll" style={{ flex: 1, minHeight: 0, padding: 20 }}>
          {step === 0 && (
            <div>
              <div style={{ ...labelStyle, marginBottom: 5 }}>Automation name</div>
              <input style={{ ...input, marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily executive brief" />
              <div style={{ ...labelStyle, marginBottom: 5 }}>Description</div>
              <textarea
                style={{ ...input, minHeight: 68, resize: 'vertical', marginBottom: 14 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this automation is for..."
              />
              <div style={{ ...labelStyle, marginBottom: 5 }}>What should Larund do?</div>
              <ReferenceToolbar onPick={addGlobalReference} />
              {references.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 10px' }}>{references.map((r) => <MentionChip key={r.id} refItem={r} onRemove={() => setReferences((x) => x.filter((y) => y.id !== r.id))} />)}</div>}
              <MentionEditor value={prompt} references={references} onChange={(t, r) => { setPrompt(t); setReferences((current) => mergeReferences(r, current)); }} userId={userId} workspaceId={workspaceId} minHeight={120}
                placeholder="Every morning, use @Gmail and @Google Calendar to summarize my day…" />

              <div style={{ marginTop: 18 }}>
                <div style={{ ...labelStyle, marginBottom: 6 }}>Chat connection</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <ChatModeOption selected={chatMode === 'create_new'} onSelect={() => setChatMode('create_new')}
                    title="Create a dedicated chat" desc={`A "${name.trim() || 'new automation'}" chat is created, and every run writes here.`} />
                  <ChatModeOption selected={chatMode === 'append_to_existing'} onSelect={() => { setChatMode('append_to_existing'); if (!linkedChatSessionId) setChatPickerOpen(true); }}
                    title="Attach to an existing chat" desc="Pick a chat where this automation's runs will appear." />
                  <ChatModeOption selected={chatMode === 'none'} onSelect={detachChat}
                    title="Don't write to chat" desc="Runs only show in the Automations / run monitor." />
                </div>
                {chatMode !== 'none' && (linkedChatSessionId ? (
                  <div style={{ ...card, marginTop: 10, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Icon name="message" size={14} stroke={1.7} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>Linked chat: <strong>{linkedChatTitle ?? '…'}</strong></span>
                    {onOpenChat && <button style={ghostBtn} onClick={openLinkedChat}>Open chat</button>}
                    <button style={ghostBtn} onClick={() => setChatPickerOpen(true)}>Change</button>
                    <button style={ghostBtn} onClick={detachChat}>Detach</button>
                  </div>
                ) : chatMode === 'append_to_existing' ? (
                  <div style={{ marginTop: 10 }}>
                    <button style={ghostBtn} onClick={() => setChatPickerOpen(true)}><Icon name="message" size={13} stroke={1.7} /> Attach existing chat</button>
                  </div>
                ) : (
                  <div style={{ ...card, marginTop: 10, marginBottom: 0, fontSize: 12, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 160 }}>A dedicated chat will be created when you save.</span>
                    <button style={ghostBtn} onClick={createNowLinkedChat} disabled={creatingChat}>{creatingChat ? 'Creating…' : 'Create now'}</button>
                  </div>
                ))}
                {chatMode === 'none' && <div style={{ ...card, marginTop: 10, marginBottom: 0, fontSize: 12, color: 'var(--warning)' }}>Runs will not appear in chat.</div>}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {TRIGGER_CARDS.map((t) => (
                  <button key={t.kind} disabled={t.disabled} onClick={() => setTkind(t.kind)} style={{ textAlign: 'left', padding: 12, borderRadius: 10, cursor: t.disabled ? 'default' : 'pointer', fontFamily: 'inherit', background: tkind === t.kind ? 'rgba(var(--accent-rgb),.1)' : 'rgba(var(--ov-color),.03)', border: `1px solid ${tkind === t.kind ? 'var(--accent)' : 'var(--border)'}`, opacity: t.disabled ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 3 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
              <div style={{ ...card, marginTop: 14 }}>
                {tkind === 'interval' && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontSize: 12.5 }}>Every</span><input type="number" min={1} value={intervalN} onChange={(e) => setIntervalN(Math.max(1, +e.target.value))} style={{ ...input, width: 90 }} /><select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as 'minutes' | 'hours' | 'days')} style={{ ...input, width: 130 }}>{['minutes', 'hours', 'days'].map((u) => <option key={u}>{u}</option>)}</select></div>}
                {(tkind === 'daily' || tkind === 'weekly' || tkind === 'monthly') && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {tkind === 'weekly' && <select value={weekday} onChange={(e) => setWeekday(+e.target.value)} style={{ ...input, width: 140 }}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
                    {tkind === 'monthly' && <select value={dom} onChange={(e) => setDom(+e.target.value)} style={{ ...input, width: 110 }}>{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}</select>}
                    <span style={{ fontSize: 12.5 }}>at</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...input, width: 130 }} />
                  </div>
                )}
                {tkind === 'cron' && <div><input value={cron} onChange={(e) => setCron(e.target.value)} style={input} placeholder="0 9 * * *" /><div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 5 }}>Advanced mode — minute hour day month weekday.</div></div>}
                {tkind === 'folder' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-hint)', lineHeight: 1.45 }}>Larund will watch this folder and run the automation when a matching file appears.</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                      <input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} style={input} placeholder="D:\\Invoices" />
                      <button style={ghostBtn} onClick={chooseTriggerFolder}><Icon name="folder" size={13} stroke={1.8} /> Choose</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 130px', gap: 8 }}>
                      <input value={folderPattern} onChange={(e) => setFolderPattern(e.target.value)} style={input} placeholder="*.pdf" />
                      <select value={folderEvent} onChange={(e) => setFolderEvent(e.target.value as FolderEvent)} style={input}>
                        <option value="file_created">File created</option>
                        <option value="file_modified">File modified</option>
                        <option value="file_created_or_modified">Created or modified</option>
                      </select>
                      <label style={{ fontSize: 11.5, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={folderIncludeSubfolders} onChange={(e) => setFolderIncludeSubfolders(e.target.checked)} />
                        Subfolders
                      </label>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div><div style={labelStyle}>Debounce (ms)</div><input type="number" min={0} step={100} value={folderDebounceMs} onChange={(e) => setFolderDebounceMs(Math.max(0, +e.target.value || 0))} style={{ ...input, marginTop: 4 }} /></div>
                      <div><div style={labelStyle}>Stable for (ms)</div><input type="number" min={0} step={100} value={folderStableForMs} onChange={(e) => setFolderStableForMs(Math.max(0, +e.target.value || 0))} style={{ ...input, marginTop: 4 }} /></div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button style={ghostBtn} onClick={testFolderAccess}><Icon name="check" size={12} stroke={2} /> Test folder access</button>
                      {folderTestMsg && <span style={{ fontSize: 11.5, color: folderTestMsg === 'Folder is accessible.' ? 'var(--success)' : 'var(--warning)' }}>{folderTestMsg}</span>}
                    </div>
                  </div>
                )}
                {tkind === 'manual' && <div style={{ fontSize: 12.5, color: 'var(--text-hint)' }}>This automation runs only when you click Run now.</div>}
                {tkind === 'webhook' && <div style={{ fontSize: 12.5, color: 'var(--text-hint)' }}>Webhook triggers are coming later.</div>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>Everything this automation can use. Add more by typing @ in the goal or attach local inputs here.</div>
              <ReferenceToolbar onPick={addGlobalReference} />
              {references.length === 0 && <div style={{ ...card, fontSize: 12.5, color: 'var(--text-hint)' }}>No references yet.</div>}
              {references.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>{references.map((r) => <MentionChip key={r.id} refItem={r} onRemove={() => setReferences((x) => x.filter((y) => y.id !== r.id))} />)}</div>}
              {deps && deps.blockers.map((b, i) => (
                <div key={i} style={{ ...card, borderColor: 'var(--danger)' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>{b.message}</div>
                  {b.action === 'connect' && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 4 }}>Open Connections to connect {b.label} before enabling this automation.</div>}
                </div>
              ))}
              {deps && deps.warnings.map((w, i) => <div key={i} style={{ ...card, borderColor: 'var(--warning)', fontSize: 12, color: 'var(--text-muted)' }}>{w.message}</div>)}
              {deps && deps.ok && deps.warnings.length === 0 && <div style={{ ...card, borderColor: 'var(--success)', fontSize: 12.5, color: 'var(--success)' }}>All referenced resources are ready.</div>}
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>One-time setup runs before recurring automation work. Use it for folders, Google Sheets, Google Docs, templates, and other infrastructure that should not be recreated every run.</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={ghostBtn} onClick={addSetupStep}>Add setup step</button>
                {setupPlan.status !== 'not_required' && <Badge text={`setup: ${setupPlan.status}`} color={setupPlan.status === 'ready' ? 'var(--success)' : setupPlan.status === 'failed' ? 'var(--danger)' : 'var(--warning)'} />}
              </div>
              {setupPlan.steps.length === 0 && <div style={{ ...card, fontSize: 12.5, color: 'var(--text-hint)' }}>No one-time setup required.</div>}
              {setupPlan.steps.map((s, i) => (
                <div key={s.id} style={card}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-hint)', width: 18 }}>{i + 1}</span>
                    <input value={s.title} onChange={(e) => updateSetupStep(s.id, { title: e.target.value })} style={{ ...input, fontWeight: 600 }} />
                    <button style={dangerBtn} onClick={() => removeSetupStep(s.id)}><Icon name="trash" size={12} stroke={1.6} /></button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <MentionEditor
                      value={s.instruction}
                      references={s.referencedContext}
                      onChange={(text, refs) => setSetupPlan((current) => ({ ...current, steps: current.steps.map((item) => item.id === s.id ? { ...item, instruction: text, referencedContext: mergeReferences(refs, item.referencedContext) } : item) }))}
                      userId={userId}
                      workspaceId={workspaceId}
                      minHeight={58}
                      placeholder="One-time setup instruction..."
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={s.required} onChange={(e) => updateSetupStep(s.id, { required: e.target.checked })} /> required</label>
                    {s.verificationHint && <Badge text={`verify: ${s.verificationHint}`} color="var(--success)" />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button style={btn} onClick={planSteps} disabled={planning}>{planning ? 'Planning…' : '✨ Let AI break this into steps'}</button>
                <button style={ghostBtn} onClick={addManualStep}>Add step manually</button>
              </div>
              {steps.length === 0 && <div style={{ ...card, fontSize: 12.5, color: 'var(--text-hint)' }}>No steps yet. Generate them with AI or add manually. Steps guide the agent at run time; they are not executed here.</div>}
              {steps.map((s, i) => (
                <div key={s.id} style={card}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-hint)', width: 18 }}>{i + 1}</span>
                    <input value={s.title} onChange={(e) => updateStep(s.id, { title: e.target.value })} style={{ ...input, fontWeight: 600 }} />
                    <button style={ghostBtn} onClick={() => moveStep(s.id, -1)} title="Up"><Icon name="arrowUp" size={12} stroke={2} /></button>
                    <button style={ghostBtn} onClick={() => moveStep(s.id, 1)} title="Down"><Icon name="arrowUp" size={12} stroke={2} style={{ transform: 'rotate(180deg)' }} /></button>
                    <button style={dangerBtn} onClick={() => removeStep(s.id)}><Icon name="trash" size={12} stroke={1.6} /></button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <MentionEditor
                      value={s.instruction}
                      references={s.referencedContext}
                      onChange={(text, refs) => setSteps((current) => current.map((item) => item.id === s.id ? { ...item, instruction: text, referencedContext: mergeReferences(refs, item.referencedContext) } : item))}
                      userId={userId}
                      workspaceId={workspaceId}
                      minHeight={58}
                      placeholder="Instruction... type @ to add step context"
                    />
                    <ReferenceToolbar onPick={(kind) => addStepReference(s.id, kind)} compact />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={s.required} onChange={(e) => updateStep(s.id, { required: e.target.checked })} /> required</label>
                    {s.verificationHint && <Badge text={`verify: ${s.verificationHint}`} color="var(--success)" />}
                    {s.referencedContext.map((r) => <MentionChip key={r.id} refItem={r} onRemove={() => updateStep(s.id, { referencedContext: s.referencedContext.filter((x) => x.id !== r.id) })} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 5 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>What proves this automation succeeded? Larund won't complete a run until required checks pass.</div>
              {VERIFY_PRESETS.map((preset) => {
                const on = verification.some((v) => v.kind === preset.kind && v.title === preset.title);
                return (
                  <label key={preset.title} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 8 }}>
                    <input type="checkbox" checked={on} onChange={() => toggleVerify(preset)} />
                    <div><div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{preset.title}</div><div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{preset.kind}</div></div>
                  </label>
                );
              })}
            </div>
          )}

          {step === 6 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SafetyRow label="Autonomy mode" value={safety.autonomyMode} options={[['manual', 'Ask before every action'], ['safe_reads', 'Safe reads automatically'], ['semi', 'Semi-autonomous']]} onChange={(v) => setSafety({ ...safety, autonomyMode: v as AutomationSafetyPolicy['autonomyMode'] })} />
              <SafetyRow label="External write" value={safety.externalWrite} options={[['ask', 'Ask'], ['allow', 'Allow for this automation'], ['block', 'Block']]} onChange={(v) => setSafety({ ...safety, externalWrite: v as AutomationSafetyPolicy['externalWrite'] })} />
              <SafetyRow label="External send / publish" value={safety.externalSend} options={[['ask', 'Always ask'], ['block', 'Block']]} onChange={(v) => setSafety({ ...safety, externalSend: v as AutomationSafetyPolicy['externalSend'] })} />
              <SafetyRow label="Destructive actions" value={safety.destructive} options={[['ask_strong', 'Always ask (strong confirm)'], ['block', 'Block']]} onChange={(v) => setSafety({ ...safety, destructive: v as AutomationSafetyPolicy['destructive'] })} />
              <SafetyRow label="Process execution" value={safety.processExec} options={[['ask', 'Ask'], ['block', 'Block']]} onChange={(v) => setSafety({ ...safety, processExec: v as AutomationSafetyPolicy['processExec'] })} />
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}><div style={labelStyle}>Max runtime (min)</div><input type="number" min={1} value={safety.maxRuntimeMinutes ?? 15} onChange={(e) => setSafety({ ...safety, maxRuntimeMinutes: +e.target.value })} style={{ ...input, marginTop: 4 }} /></div>
                <div style={{ flex: 1 }}><div style={labelStyle}>Max tool calls</div><input type="number" min={1} value={safety.maxToolCalls ?? 40} onChange={(e) => setSafety({ ...safety, maxToolCalls: +e.target.value })} style={{ ...input, marginTop: 4 }} /></div>
              </div>
              {safety.externalSend === 'ask' && <div style={{ ...card, borderColor: 'var(--warning)', fontSize: 12, color: 'var(--text-muted)' }}>External send/publish will always request approval before Larund sends anything.</div>}
            </div>
          )}

          {step === 7 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>Run once now to verify it works, then enable it.</div>
              <div style={{ ...card, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {chatMode !== 'none' && linkedChatSessionId ? (
                  <>
                    <span style={{ flex: 1, minWidth: 160 }}>Test run output will appear in: <strong style={{ color: 'var(--text-primary)' }}>{linkedChatTitle ?? 'linked chat'}</strong></span>
                    {onOpenChat && <button style={ghostBtn} onClick={openLinkedChat}>Open chat</button>}
                    <button style={ghostBtn} onClick={() => setChatPickerOpen(true)}>Change</button>
                  </>
                ) : chatMode === 'create_new' ? (
                  <span style={{ flex: 1, minWidth: 160 }}>A dedicated chat will be created on the first run.</span>
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 160 }}>This test run will only appear in the run monitor.</span>
                    <button style={ghostBtn} onClick={() => { setChatMode('append_to_existing'); setChatPickerOpen(true); }}>Attach a chat</button>
                  </>
                )}
              </div>
              <button style={btn} onClick={testRun} disabled={busy}>{busy ? 'Starting…' : 'Run once now'}</button>
              {runMsg && <div style={{ ...card, marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>{runMsg}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          {step > 0 && <button style={ghostBtn} onClick={() => goToStep(step - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          <button style={ghostBtn} onClick={saveDraftAndClose} disabled={busy || !name.trim()}>Save as draft</button>
          {step < STEPS.length - 1
            ? <button style={btn} onClick={() => canNext && goToStep(step + 1)} disabled={!canNext}>Next</button>
            : <button style={btn} onClick={enableAndClose} disabled={busy}>Enable automation</button>}
        </div>
      </div>
    </div>
    {monitorRun && (
      <RunMonitor
        automationRunId={monitorRun.runId}
        automationName={monitorRun.automationName}
        linkedChatSessionId={linkedChatSessionId}
        onOpenChat={onOpenChat ? (sessionId) => { onOpenChat(sessionId); onClose(); } : undefined}
        onClose={() => setMonitorRun(null)}
        onChanged={() => undefined}
      />
    )}
    {chatPickerOpen && (
      <ChatSessionPicker
        projectId={workspaceId ?? null}
        onCancel={() => setChatPickerOpen(false)}
        onSelect={attachSession}
      />
    )}
    </>
  );
}

function ChatModeOption({ selected, onSelect, title, desc }: { selected: boolean; onSelect: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onSelect} style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 9, background: selected ? 'rgba(var(--accent-rgb),.1)' : 'rgba(var(--ov-color),.03)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}` }}>
      <span style={{ width: 15, height: 15, borderRadius: '50%', marginTop: 1, border: `2px solid ${selected ? 'var(--accent)' : 'var(--text-hint)'}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{selected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>{desc}</span>
      </span>
    </button>
  );
}

function SafetyRow({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div style={card}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onChange(v)} style={{ ...ghostBtn, ...(value === v ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}

function splitSetupAndRunSteps(steps: AutomationStep[]): { setup: AutomationStep[]; run: AutomationStep[] } {
  const setupPattern = /google\.sheets\.create|google\.docs\.create|google\.drive\.create_folder|create google sheet infrastructure|create google doc infrastructure|create drive folder infrastructure|prepare local output infrastructure|validate google sheet|validate google doc|validate drive folder/i;
  const setup = steps.filter((step) => setupPattern.test(`${step.title}\n${step.instruction}`)).map((step, index) => ({ ...step, order: index }));
  const run = steps.filter((step) => !setupPattern.test(`${step.title}\n${step.instruction}`)).map((step, index) => ({ ...step, order: index }));
  return { setup, run: run.length ? run : steps.map((step, index) => ({ ...step, order: index })) };
}

function ReferenceToolbar({ onPick, compact = false }: {
  onPick: (kind: 'file' | 'folder' | 'url') => void | Promise<void>;
  compact?: boolean;
}) {
  const toolbarBtn = {
    ...ghostBtn,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '5px 8px' : '7px 10px',
    fontSize: compact ? 11.5 : 12,
  } satisfies CSSProperties;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: compact ? '6px 0 0' : '0 0 10px' }}>
      <button type="button" style={toolbarBtn} onClick={() => void onPick('file')}><Icon name="fileText" size={13} stroke={1.7} /> File</button>
      <button type="button" style={toolbarBtn} onClick={() => void onPick('folder')}><Icon name="folder" size={13} stroke={1.7} /> Folder</button>
      <button type="button" style={toolbarBtn} onClick={() => void onPick('url')}><Icon name="link" size={13} stroke={1.7} /> URL</button>
    </div>
  );
}
