// Multi-step New Automation wizard: Goal → Trigger → Context → Steps → Verify →
// Safety → Test. Builds the full workflow definition (prompt + mentions + trigger
// + AI-planned steps + verification + safety) and saves it through the existing
// automation store; the test run uses the real runAutomation path (AutomationRun
// + TaskRun + evidence).

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { MentionEditor, MentionChip } from '../mentions/MentionEditor';
import type { ReferencedContext } from '../../lib/mentions/types';
import { listCatalogProviders } from '../../lib/connections/catalog';
import { createAutomation, updateAutomation } from '../../lib/automations/store';
import { runAutomation } from '../../lib/automations/runner';
import { generateAutomationSteps } from '../../lib/automations/planner';
import { checkAutomationDependencies, type DependencyReport } from '../../lib/automations/dependencies';
import { defaultSafetyPolicy } from '../../lib/automations/migrate';
import type { Automation, AutomationStep, AutomationTrigger, AutomationSafetyPolicy, VerificationCheck } from '../../lib/automations/types';
import { MODELS } from '../../constants/models';
import { card, btn, ghostBtn, dangerBtn, input, labelStyle, Badge } from '../pages/ui';

const STEPS = ['Goal', 'Trigger', 'Context', 'Steps', 'Verify', 'Safety', 'Test'] as const;

type TriggerKind = 'manual' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron' | 'folder' | 'webhook';
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
  safety?: AutomationSafetyPolicy;
}

export function NewAutomationWizard({ userId, workspaceId, initial, editId, onClose, onSaved }: {
  userId: string; workspaceId?: string; initial?: WizardInitial; editId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [references, setReferences] = useState<ReferencedContext[]>(initial?.references ?? []);

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

  const [steps, setSteps] = useState<AutomationStep[]>(initial?.steps ?? []);
  const [planning, setPlanning] = useState(false);
  const [verification, setVerification] = useState<VerificationCheck[]>(initial?.verification ?? [{ id: 'v-readback', title: 'Output was read back', kind: 'file_read_back', required: true }]);
  const [safety, setSafety] = useState<AutomationSafetyPolicy>(initial?.safety ?? defaultSafetyPolicy('semi'));

  const [savedId, setSavedId] = useState<string | null>(editId ?? null);
  const [runMsg, setRunMsg] = useState('');
  const [deps, setDeps] = useState<DependencyReport | null>(null);
  const [busy, setBusy] = useState(false);

  const connectedIds = useMemo(() => new Set(listCatalogProviders().filter((p) => p.runtime === 'connected').map((p) => p.id)), []);
  const isConnected = (id: string) => connectedIds.has(id);

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
      case 'folder': return { kind: 'folder_watch', path: folderPath.trim(), pattern: folderPattern.trim() || undefined };
      case 'webhook': return { kind: 'manual' };
    }
  }

  function draftAutomation(): Automation {
    const now = new Date().toISOString();
    return {
      id: savedId ?? 'draft', userId, workspaceId, name: name || 'Untitled automation',
      description,
      enabled: false, trigger: buildTrigger(),
      taskTemplate: { prompt, requiredConnectionIds: references.filter((r) => r.kind === 'connection').map((r) => r.refId), skillIds: references.filter((r) => r.kind === 'skill').map((r) => r.refId) },
      autonomyMode: safety.autonomyMode === 'manual' ? 'manual' : 'semi',
      approvalPolicy: { externalSendRequiresApproval: safety.externalSend === 'ask', destructiveRequiresApproval: safety.destructive === 'ask_strong' },
      status: 'disabled', prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety,
      createdAt: now, updatedAt: now,
    };
  }

  // Re-check dependencies whenever we reach the Context step.
  useEffect(() => {
    if (step === 2) void checkAutomationDependencies(draftAutomation(), { userId, workspaceId }).then(setDeps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function planSteps() {
    setPlanning(true);
    try {
      const modelId = MODELS.find((m) => m.id === 'core')?.openrouter_id ?? 'anthropic/claude-haiku-4-5';
      const res = await generateAutomationSteps({ prompt, referencedContext: references }, modelId, userId, isConnected);
      setSteps(res.steps);
    } finally { setPlanning(false); }
  }

  function addManualStep() {
    setSteps((s) => [...s, { id: `step-${Date.now()}`, title: 'New step', instruction: '', referencedContext: [], required: true, order: s.length }]);
  }
  function updateStep(id: string, patch: Partial<AutomationStep>) { setSteps((s) => s.map((x) => x.id === id ? { ...x, ...patch } : x)); }
  function removeStep(id: string) { setSteps((s) => s.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i }))); }
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
      await updateAutomation(savedId, { name: name || 'Untitled automation', description, enabled, status: enabled ? 'active' : 'disabled', trigger: buildTrigger(), prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety, taskTemplate: draftAutomation().taskTemplate });
      return savedId;
    }
    const created = await createAutomation({ userId, workspaceId, name: name || 'Untitled automation', description, enabled, trigger: buildTrigger(), taskTemplate: draftAutomation().taskTemplate, prompt, referencedContext: references, steps, verificationChecklist: verification, safetyPolicy: safety });
    setSavedId(created.id);
    return created.id;
  }

  async function testRun() {
    setBusy(true); setRunMsg('');
    try {
      const id = await persist(false);
      const r = await runAutomation(id, { reason: 'test_run' });
      setRunMsg(`Test run started — created automation run ${r.automationRunId.slice(0, 16)}… and a TaskRun with evidence. Open the Tasks page to watch it.`);
    } catch (e) {
      setRunMsg(`Test run failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally { setBusy(false); }
  }

  async function enableAndClose() {
    setBusy(true);
    try { await persist(true); onSaved(); onClose(); } finally { setBusy(false); }
  }
  async function saveDraftAndClose() {
    setBusy(true);
    try { await persist(false); onSaved(); onClose(); } finally { setBusy(false); }
  }

  const canNext = step === 0 ? Boolean(name.trim() && prompt.trim()) : true;

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 100, background: 'rgba(0,0,0,.7)' }}>
      <div className="modal-pop" style={{ width: 720, maxWidth: '94vw', maxHeight: '92vh', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => i <= step && setStep(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: i <= step ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: i === step ? 'var(--accent)' : i < step ? 'rgba(62,207,142,.2)' : 'rgba(var(--ov-color),.07)', color: i === step ? 'var(--on-accent)' : i < step ? 'var(--success)' : 'var(--text-hint)' }}>{i < step ? '✓' : i + 1}</span>
              <span style={{ fontSize: 12, color: i === step ? 'var(--text-primary)' : 'var(--text-hint)', fontWeight: i === step ? 600 : 400 }}>{s}</span>
              {i < STEPS.length - 1 && <span style={{ width: 12, height: 1, background: 'var(--border)', margin: '0 2px' }} />}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)' }}><Icon name="x" size={16} stroke={2} /></button>
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
              <MentionEditor value={prompt} references={references} onChange={(t, r) => { setPrompt(t); setReferences(r); }} userId={userId} workspaceId={workspaceId} minHeight={120}
                placeholder="Every morning, use @Gmail and @Google Calendar to summarize my day…" />
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {TRIGGER_CARDS.map((t) => (
                  <button key={t.kind} disabled={t.disabled} onClick={() => setTkind(t.kind)} style={{ textAlign: 'left', padding: 12, borderRadius: 10, cursor: t.disabled ? 'default' : 'pointer', fontFamily: 'inherit', background: tkind === t.kind ? 'rgba(74,158,255,.1)' : 'rgba(var(--ov-color),.03)', border: `1px solid ${tkind === t.kind ? 'var(--accent)' : 'var(--border)'}`, opacity: t.disabled ? 0.5 : 1 }}>
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
                {tkind === 'folder' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}><input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} style={input} placeholder="D:\\Invoices" /><input value={folderPattern} onChange={(e) => setFolderPattern(e.target.value)} style={input} placeholder="*.pdf" /></div>}
                {tkind === 'manual' && <div style={{ fontSize: 12.5, color: 'var(--text-hint)' }}>This automation runs only when you click Run now.</div>}
                {tkind === 'webhook' && <div style={{ fontSize: 12.5, color: 'var(--text-hint)' }}>Webhook triggers are coming later.</div>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>Everything this automation can use. Add more by typing @ in the goal (Step 1).</div>
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
                      onChange={(text, refs) => updateStep(s.id, { instruction: text, referencedContext: refs })}
                      userId={userId}
                      workspaceId={workspaceId}
                      minHeight={58}
                      placeholder="Instruction... type @ to add step context"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 5 }}><input type="checkbox" checked={s.required} onChange={(e) => updateStep(s.id, { required: e.target.checked })} /> required</label>
                    {s.verificationHint && <Badge text={`verify: ${s.verificationHint}`} color="var(--success)" />}
                    {s.referencedContext.map((r) => <MentionChip key={r.id} refItem={r} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
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

          {step === 5 && (
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

          {step === 6 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-hint)', marginBottom: 12 }}>Run once now to verify it works, then enable it.</div>
              <button style={btn} onClick={testRun} disabled={busy}>{busy ? 'Starting…' : 'Run once now'}</button>
              {runMsg && <div style={{ ...card, marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>{runMsg}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          {step > 0 && <button style={ghostBtn} onClick={() => setStep((s) => s - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          <button style={ghostBtn} onClick={saveDraftAndClose} disabled={busy || !name.trim()}>Save as draft</button>
          {step < STEPS.length - 1
            ? <button style={btn} onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}>Next</button>
            : <button style={btn} onClick={enableAndClose} disabled={busy}>Enable automation</button>}
        </div>
      </div>
    </div>
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
