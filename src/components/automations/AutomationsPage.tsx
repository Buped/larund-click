// The Automations workflow-builder: a polished directory of saved automations
// with filters, stats, an example-template empty state, the multi-step New
// Automation wizard, and a detail page. Built on the existing automation store /
// runner / queue / evidence systems.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { MentionChip } from '../mentions/MentionEditor';
import { listAutomations, pauseAutomation, resumeAutomation, getAutomation, listAutomationRuns } from '../../lib/automations/store';
import { runAutomation } from '../../lib/automations/runner';
import { cancelAutomationRun, ensureAutomationQueueProcessor, isAutomationQueueProcessorInstalled } from '../../lib/automations/agent-processor';
import { normalizeAutomation } from '../../lib/automations/migrate';
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from '../../lib/automations/templates';
import type { Automation, AutomationRun } from '../../lib/automations/types';
import { resourceToReference } from '../../lib/mentions/types';
import { listCatalogProviders } from '../../lib/connections/catalog';
import { triggerSummary } from './shared';
import { NewAutomationWizard, type WizardInitial } from './NewAutomationWizard';
import { AutomationDetail } from './AutomationDetail';
import { RunMonitor } from './RunMonitor';
import { PageFrame, PageHeader, SearchInput, Badge, card, btn, ghostBtn, statusColor, useAsyncList } from '../pages/ui';

const TABS = ['All', 'Active', 'Paused', 'Failed', 'Manual', 'Scheduled', 'Event-triggered'] as const;
type Tab = typeof TABS[number];

function statusOf(a: Automation): 'active' | 'paused' | 'failed' | 'draft' {
  if (a.status === 'error') return 'failed';
  if (a.status === 'disabled') return 'draft';
  if (!a.enabled || a.status === 'paused') return 'paused';
  return 'active';
}

function templateToInitial(t: AutomationTemplate): WizardInitial {
  // Map suggested connections to mention references so the wizard shows chips +
  // runs dependency checks against them.
  const providers = listCatalogProviders();
  const references = t.suggestedConnectionIds.map((id) => {
    const p = providers.find((x) => x.id === id);
    return resourceToReference({ kind: 'connection', refId: id, label: p?.name ?? id, available: p?.runtime === 'connected', detail: '' });
  });
  return { name: t.name, prompt: t.prompt, references, trigger: t.suggestedTrigger, verification: t.verification };
}

function TemplateGallery({ onPick }: { onPick: (t: AutomationTemplate) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {AUTOMATION_TEMPLATES.map((t) => (
        <button key={t.id} className="conn-card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => onPick(t)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <BrandIcon providerId={t.iconProviderId} size={34} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, minHeight: 50 }}>{t.description}</div>
          <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 8 }}>Use template →</div>
        </button>
      ))}
    </div>
  );
}

function isActiveRun(run?: AutomationRun): boolean {
  return Boolean(run && ['queued', 'running', 'waiting_approval', 'waiting_user'].includes(run.status));
}

function AutomationCard({ a, run, onOpen, onRun, onToggle, onWatch, onStop }: {
  a: Automation;
  run?: AutomationRun;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onWatch: () => void;
  onStop: () => void;
}) {
  const norm = normalizeAutomation(a);
  const status = statusOf(a);
  const activeRun = isActiveRun(run);
  const last = a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : '—';
  const next = a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : '—';
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <button onClick={onOpen} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, flex: 1, minWidth: 0, fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{a.name}</strong>
            <Badge text={status} color={statusColor(status)} />
            {activeRun && <Badge text={run!.status.replace('_', ' ')} color="var(--accent)" />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>{triggerSummary(a.trigger)}</div>
        </button>
      </div>
      {norm.referencedContext.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {norm.referencedContext.slice(0, 5).map((r) => <MentionChip key={r.id} refItem={r} />)}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 8 }}>Last run: {last} · Next: {next}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {activeRun ? (
          <>
            <button style={btn} onClick={onWatch}><Icon name="eye" size={12} /> Watch live</button>
            <button style={ghostBtn} onClick={onStop}><Icon name="stop" size={11} /> Stop</button>
          </>
        ) : (
          <button style={btn} onClick={onRun}>Run now</button>
        )}
        <button style={ghostBtn} onClick={onToggle}>{a.enabled ? 'Pause' : 'Resume'}</button>
        <button style={ghostBtn} onClick={onOpen}>Open</button>
      </div>
    </div>
  );
}

export function AutomationsPage({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const { items, loading, reload } = useAsyncList<Automation>(() => listAutomations({ userId, workspaceId, includeDisabled: true }), [userId, workspaceId]);
  const [tab, setTab] = useState<Tab>('All');
  const [query, setQuery] = useState('');
  const [wizard, setWizard] = useState<{ open: boolean; initial?: WizardInitial; editId?: string }>({ open: false });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [latestRuns, setLatestRuns] = useState<Record<string, AutomationRun | undefined>>({});
  const [monitor, setMonitor] = useState<{ runId: string; automationName?: string; readonly?: boolean } | null>(null);
  const [runnerConnected, setRunnerConnected] = useState(() => isAutomationQueueProcessorInstalled());

  useEffect(() => {
    ensureAutomationQueueProcessor();
    setRunnerConnected(isAutomationQueueProcessorInstalled());
  }, []);

  async function loadLatestRuns(list = items) {
    const entries = await Promise.all(list.map(async (a) => [a.id, (await listAutomationRuns(a.id))[0]] as const));
    setLatestRuns(Object.fromEntries(entries));
  }

  useEffect(() => {
    void loadLatestRuns(items);
    const timer = window.setInterval(() => void loadLatestRuns(items), 1800);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((a) => a.id).join('|')]);

  async function editAutomation(id: string) {
    const a = await getAutomation(id);
    if (!a) return;
    const n = normalizeAutomation(a);
    setDetailId(null);
    setWizard({ open: true, editId: id, initial: { name: n.name, description: n.description, prompt: n.prompt, references: n.referencedContext, trigger: n.trigger, verification: n.verificationChecklist, steps: n.steps, safety: n.safetyPolicy } });
  }

  if (detailId) {
    return <AutomationDetail automationId={detailId} userId={userId} workspaceId={workspaceId} onBack={() => setDetailId(null)} onEdit={() => editAutomation(detailId)} onChanged={reload} />;
  }

  function matches(a: Automation): boolean {
    if (query && !`${a.name} ${a.prompt ?? a.taskTemplate.prompt}`.toLowerCase().includes(query.toLowerCase())) return false;
    const s = statusOf(a);
    switch (tab) {
      case 'All': return true;
      case 'Active': return s === 'active';
      case 'Paused': return s === 'paused' || s === 'draft';
      case 'Failed': return s === 'failed';
      case 'Manual': return a.trigger.kind === 'manual';
      case 'Scheduled': return a.trigger.kind === 'schedule';
      case 'Event-triggered': return a.trigger.kind === 'folder_watch' || a.trigger.kind === 'webhook' || a.trigger.kind === 'connection_event';
    }
  }
  const filtered = items.filter(matches);

  const stats = {
    active: items.filter((a) => statusOf(a) === 'active').length,
    waiting: items.filter((a) => a.status === 'paused').length,
    failed: items.filter((a) => statusOf(a) === 'failed').length,
  };

  async function run(a: Automation) {
    const result = await runAutomation(a.id, { reason: 'manual_run' }).catch(() => null);
    void result;
    reload();
    void loadLatestRuns();
  }
  async function stop(run?: AutomationRun) {
    if (!run) return;
    await cancelAutomationRun(run.id);
    reload();
    void loadLatestRuns();
  }
  async function toggle(a: Automation) { a.enabled ? await pauseAutomation(a.id) : await resumeAutomation(a.id); reload(); }

  return (
    <PageFrame>
      <PageHeader
        title="Automations"
        subtitle="Create recurring, scheduled, manual, and event-triggered AI workflows."
        actions={<button style={btn} onClick={() => setWizard({ open: true })}><Icon name="plus" size={13} stroke={2} /> New automation</button>}
      />

      {!runnerConnected && (
        <div style={{ ...card, borderColor: 'var(--warning)', color: 'var(--text-muted)', fontSize: 12.5 }}>
          <strong style={{ color: 'var(--warning)' }}>Automation runner is not connected.</strong> Manual runs will only be queued until the agent queue processor is registered.
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {([['Active', stats.active, 'var(--success)'], ['Waiting', stats.waiting, 'var(--warning)'], ['Failed last run', stats.failed, 'var(--danger)']] as const).map(([label, n, color]) => (
            <div key={label} style={{ ...card, marginBottom: 0, padding: '10px 14px', flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{n}</div>
              <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <div>
          <div style={{ textAlign: 'center', padding: '20px 0 26px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Build your first automation</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 16px' }}>Start from a template, or create one from scratch.</div>
            <button style={btn} onClick={() => setWizard({ open: true })}><Icon name="plus" size={13} stroke={2} /> Create your first automation</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Templates</div>
          <TemplateGallery onPick={(t) => setWizard({ open: true, initial: templateToInitial(t) })} />
        </div>
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Search automations…" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ ...ghostBtn, ...(tab === t ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filtered.map((a) => (
              <AutomationCard
                key={a.id}
                a={a}
                run={latestRuns[a.id]}
                onOpen={() => setDetailId(a.id)}
                onRun={() => run(a)}
                onToggle={() => toggle(a)}
                onWatch={() => latestRuns[a.id] && setMonitor({ runId: latestRuns[a.id]!.id, automationName: a.name })}
                onStop={() => stop(latestRuns[a.id])}
              />
            ))}
          </div>
          {filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-hint)', fontSize: 13 }}>No automations match this filter.</div>}
        </>
      )}

      {wizard.open && (
        <NewAutomationWizard userId={userId} workspaceId={workspaceId} initial={wizard.initial} editId={wizard.editId} onClose={() => setWizard({ open: false })} onSaved={reload} />
      )}
      {monitor && (
        <RunMonitor
          automationRunId={monitor.runId}
          automationName={monitor.automationName}
          readonly={monitor.readonly}
          onClose={() => setMonitor(null)}
          onChanged={() => { reload(); void loadLatestRuns(); }}
        />
      )}
    </PageFrame>
  );
}
