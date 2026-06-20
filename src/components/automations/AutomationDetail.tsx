// Automation detail: overview, trigger, prompt + referenced context, steps,
// verification, safety, and clickable run history with evidence replay.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { MentionChip } from '../mentions/MentionEditor';
import { getAutomation, listAutomationRuns, pauseAutomation, resumeAutomation, deleteAutomation, createAutomation } from '../../lib/automations/store';
import { runAutomation } from '../../lib/automations/runner';
import { checkAutomationDependencies, type DependencyReport } from '../../lib/automations/dependencies';
import { normalizeAutomation, type NormalizedAutomation } from '../../lib/automations/migrate';
import { triggerSummary } from './shared';
import { RunMonitor } from './RunMonitor';
import type { AutomationRun } from '../../lib/automations/types';
import { PageFrame, card, btn, ghostBtn, dangerBtn, labelStyle, Badge, Empty, statusColor } from '../pages/ui';

export function AutomationDetail({ automationId, userId, workspaceId, onBack, onEdit, onChanged }: {
  automationId: string;
  userId: string;
  workspaceId?: string;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [auto, setAuto] = useState<NormalizedAutomation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [deps, setDeps] = useState<DependencyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [monitor, setMonitor] = useState<{ runId: string; readonly?: boolean } | null>(null);

  async function load() {
    const a = await getAutomation(automationId);
    if (!a) {
      onBack();
      return;
    }
    const norm = normalizeAutomation(a);
    setAuto(norm);
    setRuns(await listAutomationRuns(automationId));
    setDeps(await checkAutomationDependencies(a, { userId, workspaceId }));
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [automationId]);

  if (!auto) return <PageFrame><div style={{ color: 'var(--text-hint)', fontSize: 12.5 }}>Loading...</div></PageFrame>;

  async function runNow() {
    setBusy(true);
    try {
      await runAutomation(automationId, { reason: 'manual_run' });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    setBusy(true);
    try {
      auto!.enabled ? await pauseAutomation(automationId) : await resumeAutomation(automationId);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    setBusy(true);
    try {
      await createAutomation({
        userId,
        workspaceId,
        name: `${auto!.name} (copy)`,
        description: auto!.description,
        enabled: false,
        trigger: auto!.trigger,
        taskTemplate: auto!.taskTemplate,
        prompt: auto!.prompt,
        referencedContext: auto!.referencedContext,
        steps: auto!.steps,
        verificationChecklist: auto!.verificationChecklist,
        safetyPolicy: auto!.safetyPolicy,
      });
      onChanged();
      onBack();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteAutomation(automationId);
      onChanged();
      onBack();
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(auto, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${auto!.name.replace(/\W+/g, '-')}.automation.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusText = auto.status === 'error' ? 'failed' : !auto.enabled ? 'paused' : auto.status;

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> Automations</button>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>{auto.name}</h1>
            <Badge text={statusText} color={statusColor(statusText)} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '5px 0 0' }}>{triggerSummary(auto.trigger)}</p>
          {auto.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.45 }}>{auto.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button style={btn} onClick={runNow} disabled={busy}>Run now</button>
          <button style={ghostBtn} onClick={togglePause} disabled={busy}>{auto.enabled ? 'Pause' : 'Resume'}</button>
          <button style={ghostBtn} onClick={onEdit}>Edit</button>
          <button style={ghostBtn} onClick={duplicate} disabled={busy}>Duplicate</button>
          <button style={ghostBtn} onClick={exportJson}>Export</button>
          <button style={dangerBtn} onClick={remove} disabled={busy}>Delete</button>
        </div>
      </div>

      {deps && deps.blockers.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--danger)' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--danger)' }}>Dependencies missing</strong>
          {deps.blockers.map((b, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>- {b.message}</div>)}
        </div>
      )}

      <Section title="Goal & context">
        <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{auto.prompt}</div>
        {auto.referencedContext.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {auto.referencedContext.map((r) => <MentionChip key={r.id} refItem={r} />)}
          </div>
        )}
      </Section>

      {auto.steps.length > 0 && (
        <Section title="Steps">
          {[...auto.steps].sort((a, b) => a.order - b.order).map((s, i) => (
            <div key={s.id} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>{i + 1}. {s.title}{!s.required && ' (optional)'}</div>
              {s.instruction && <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>{s.instruction}</div>}
            </div>
          ))}
        </Section>
      )}

      <Section title="Verification">
        {auto.verificationChecklist.map((v) => <div key={v.id} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>- {v.title} <span style={{ color: 'var(--text-hint)' }}>({v.kind})</span></div>)}
      </Section>

      <Section title="Safety">
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Autonomy: <b>{auto.safetyPolicy.autonomyMode}</b> / External write: <b>{auto.safetyPolicy.externalWrite}</b> / External send: <b>{auto.safetyPolicy.externalSend}</b> / Destructive: <b>{auto.safetyPolicy.destructive}</b>
          {auto.safetyPolicy.maxRuntimeMinutes ? ` / Max ${auto.safetyPolicy.maxRuntimeMinutes}min` : ''}{auto.safetyPolicy.maxToolCalls ? ` / Max ${auto.safetyPolicy.maxToolCalls} calls` : ''}
        </div>
      </Section>

      <div style={{ ...labelStyle, margin: '8px 0 8px' }}>Run history</div>
      {runs.length === 0 && <Empty text="No runs yet. Click Run now to start one." icon="clock" />}
      {runs.map((r) => (
        <div key={r.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12 }}>{new Date(r.startedAt ?? r.completedAt ?? Date.now()).toLocaleString()}</strong>
            <Badge text={r.status} color={statusColor(r.status)} />
          </div>
          {r.error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{r.error}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button style={ghostBtn} onClick={() => setMonitor({ runId: r.id, readonly: true })}><Icon name="eye" size={12} /> Open run</button>
            {r.taskRunId && <span style={{ fontSize: 11, color: 'var(--text-hint)', alignSelf: 'center' }}>TaskRun: {r.taskRunId}</span>}
          </div>
        </div>
      ))}

      {monitor && (
        <RunMonitor
          automationRunId={monitor.runId}
          automationName={auto.name}
          readonly={monitor.readonly}
          onClose={() => setMonitor(null)}
          onChanged={() => { void load(); onChanged(); }}
        />
      )}
    </PageFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
