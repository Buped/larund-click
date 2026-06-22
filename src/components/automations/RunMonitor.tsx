import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { Badge, btn, dangerBtn, ghostBtn, statusColor } from '../pages/ui';
import {
  answerAutomationRun,
  cancelAutomationRun,
  getAutomationRunSnapshot,
  resolveAutomationApproval,
  type AutomationRunSnapshot,
} from '../../lib/automations/agent-processor';
import type { AgentStep } from '../../lib/control-system/loop';
import type { EvidenceEntry } from '../../lib/tasks/types';

export function RunMonitor({
  automationRunId,
  automationName,
  readonly = false,
  linkedChatSessionId,
  onOpenChat,
  onClose,
  onChanged,
}: {
  automationRunId: string;
  automationName?: string;
  readonly?: boolean;
  linkedChatSessionId?: string;
  onOpenChat?: (sessionId: string) => void;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AutomationRunSnapshot | null>(null);
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    const next = await getAutomationRunSnapshot(automationRunId);
    setSnapshot(next);
  }

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await getAutomationRunSnapshot(automationRunId);
      if (alive) setSnapshot(next);
    };
    void tick();
    const timer = window.setInterval(tick, 1200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [automationRunId]);

  const status = snapshot?.run?.status ?? snapshot?.queueItem?.status ?? snapshot?.live?.status ?? 'queued';
  const active = status === 'queued' || status === 'running' || status === 'waiting_approval' || status === 'waiting_user';
  const timeline = useMemo(() => buildTimeline(snapshot), [snapshot]);
  const startedAt = snapshot?.run?.startedAt ?? snapshot?.queueItem?.startedAt ?? snapshot?.queueItem?.createdAt;
  const duration = startedAt ? durationText(startedAt, snapshot?.run?.completedAt ?? snapshot?.queueItem?.completedAt) : '-';
  const summary = snapshot?.run?.error ?? snapshot?.taskRun?.error ?? snapshot?.taskRun?.summary ?? snapshot?.live?.progress ?? snapshot?.queueItem?.error ?? snapshot?.queueItem?.progress ?? '';
  // A run paused for input/approval keeps its resolve callback in memory only. If
  // the app reloaded (or HMR reset state) the live state is gone and the run can't
  // be answered — it must be stopped and re-run. Detect that orphaned state.
  const waitingButOrphaned = (status === 'waiting_user' || status === 'waiting_approval')
    && !snapshot?.live?.ask && !snapshot?.live?.approval;
  // Prefer the explicit prop; fall back to the session the run actually wrote into.
  const chatSessionId = linkedChatSessionId ?? snapshot?.run?.chatSessionId;

  async function stop() {
    await cancelAutomationRun(automationRunId);
    await load();
    onChanged?.();
  }

  async function sendAnswer() {
    if (!answer.trim()) return;
    answerAutomationRun(automationRunId, answer.trim());
    setAnswer('');
    await load();
    onChanged?.();
  }

  async function approval(decision: 'allow_once' | 'allow_always' | 'deny') {
    resolveAutomationApproval(automationRunId, decision);
    await load();
    onChanged?.();
  }

  async function copySummary() {
    const text = [
      `${automationName ?? 'Automation'} - ${status}`,
      summary,
      ...timeline.map((item) => `${item.time} ${item.label}: ${item.preview}`),
    ].filter(Boolean).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 17, margin: 0 }}>{automationName ?? 'Automation run'}</h2>
              <Badge text={String(status).replace('_', ' ')} color={statusColor(String(status))} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 5 }}>
              Started: {startedAt ? new Date(startedAt).toLocaleString() : '-'} · Duration: {duration}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 4 }}>
              Queue: {snapshot?.queueItem?.id ?? '-'} · TaskRun: {snapshot?.taskRun?.id ?? snapshot?.live?.taskRunId ?? '-'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {chatSessionId && onOpenChat && (
              <button style={ghostBtn} onClick={() => onOpenChat(chatSessionId)}><Icon name="message" size={12} stroke={1.7} /> Open linked chat</button>
            )}
            <button style={ghostBtn} onClick={onClose} title="Close"><Icon name="x" size={13} /></button>
          </div>
        </div>

        {summary && (
          <div style={{ ...panelStyle, borderColor: status === 'failed' ? 'var(--danger)' : 'rgba(var(--ov-color),0.09)' }}>
            <div style={{ fontSize: 12.5, color: status === 'failed' ? 'var(--danger)' : 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{summary}</div>
          </div>
        )}

        {waitingButOrphaned && !readonly && (
          <div style={{ ...panelStyle, borderColor: 'var(--warning)' }}>
            <strong style={{ fontSize: 13 }}>Run interrupted</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              This run was waiting for input or approval when the app reloaded, so it can no longer resume. Stop it and run the automation again.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button style={dangerBtn} onClick={stop}><Icon name="stop" size={12} /> Stop run</button>
            </div>
          </div>
        )}

        {snapshot?.live?.approval && !readonly && (
          <div style={{ ...panelStyle, borderColor: 'var(--warning)' }}>
            <strong style={{ fontSize: 13 }}>Approval needed</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{snapshot.live.approval.action} · {snapshot.live.approval.risk}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>{snapshot.live.approval.reason}</div>
            <pre style={rawStyle}>{snapshot.live.approval.argsSummary}</pre>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button style={btn} onClick={() => approval('allow_once')}>Allow once</button>
              {!/external_send|destructive/.test(snapshot.live.approval.risk) && <button style={ghostBtn} onClick={() => approval('allow_always')}>Allow always</button>}
              <button style={dangerBtn} onClick={() => approval('deny')}>Deny</button>
            </div>
          </div>
        )}

        {snapshot?.live?.ask && !readonly && (
          <div style={{ ...panelStyle, borderColor: 'var(--warning)' }}>
            <strong style={{ fontSize: 13 }}>Input needed</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{snapshot.live.ask.question}</div>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Answer and continue..."
              style={{ width: '100%', marginTop: 9, minHeight: 70, resize: 'vertical', background: 'var(--bg-field)', border: '1px solid var(--border)', borderRadius: 8, padding: 9, color: 'var(--text-primary)', fontFamily: 'inherit' }}
            />
            <button style={{ ...btn, marginTop: 8 }} onClick={sendAnswer}>Continue</button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '12px 0 8px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Timeline</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{timeline.length} steps</div>
        </div>
        <div style={{ maxHeight: '42vh', overflow: 'auto', paddingRight: 4 }}>
          {timeline.length === 0 && <div style={{ ...panelStyle, color: 'var(--text-hint)', fontSize: 12.5 }}>Waiting for the first agent step...</div>}
          {timeline.map((item) => (
            <details key={item.id} style={{ ...panelStyle, marginBottom: 8 }} open={item.kind === 'error'}>
              <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge text={item.kind} color={item.kind === 'error' ? 'var(--danger)' : item.kind === 'approval' ? 'var(--warning)' : 'var(--accent)'} />
                <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1 }}>{item.label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{item.time}</span>
              </summary>
              {item.preview && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 7, whiteSpace: 'pre-wrap' }}>{item.preview}</div>}
              {item.raw && <pre style={rawStyle}>{item.raw}</pre>}
            </details>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {active && !readonly && <button style={dangerBtn} onClick={stop}><Icon name="stop" size={12} /> Stop run</button>}
            <button style={ghostBtn} onClick={copySummary}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : 'Copy run summary'}</button>
          </div>
          <button style={ghostBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function buildTimeline(snapshot: AutomationRunSnapshot | null): Array<{
  id: string;
  kind: string;
  label: string;
  preview: string;
  raw: string;
  time: string;
}> {
  if (!snapshot) return [];
  const prefix = folderTriggerItem(snapshot);
  if (snapshot.live?.steps.length) {
    return [...prefix, ...snapshot.live.steps.map((step) => stepToItem(step))];
  }
  return [...prefix, ...snapshot.evidence.map((ev) => evidenceToItem(ev))];
}

function folderTriggerItem(snapshot: AutomationRunSnapshot): Array<{
  id: string;
  kind: string;
  label: string;
  preview: string;
  raw: string;
  time: string;
}> {
  const payload = snapshot.run?.triggerPayload;
  if (!payload || payload.kind !== 'folder_watch') return [];
  const fileName = typeof payload.fileName === 'string'
    ? payload.fileName
    : typeof payload.filePath === 'string'
      ? payload.filePath.split(/[\\/]/).pop() ?? payload.filePath
      : 'matching file';
  const createdAt = typeof payload.detectedAt === 'string' ? payload.detectedAt : snapshot.run?.startedAt ?? new Date().toISOString();
  return [{
    id: `${snapshot.run?.id ?? 'run'}-folder-trigger`,
    kind: 'trigger',
    label: `New file detected: ${fileName}`,
    preview: [
      payload.filePath ? `File: ${String(payload.filePath)}` : undefined,
      payload.folderPath || payload.watchedPath ? `Folder: ${String(payload.folderPath ?? payload.watchedPath)}` : undefined,
      payload.eventType ? `Event: ${String(payload.eventType)}` : undefined,
      payload.pattern ? `Pattern: ${String(payload.pattern)}` : undefined,
    ].filter(Boolean).join('\n'),
    raw: JSON.stringify(payload, null, 2),
    time: new Date(createdAt).toLocaleTimeString(),
  }];
}

function stepToItem(step: AgentStep) {
  const preview = step.output ?? step.error ?? step.input ?? '';
  return {
    id: step.id,
    kind: step.type,
    label: step.tool ? `${step.type.replace('_', ' ')} · ${step.tool}` : step.type.replace('_', ' '),
    preview: preview.slice(0, 700),
    raw: JSON.stringify(step, null, 2),
    time: new Date(step.timestamp).toLocaleTimeString(),
  };
}

function evidenceToItem(ev: EvidenceEntry) {
  return {
    id: ev.id,
    kind: ev.kind,
    label: ev.title,
    preview: ev.content.slice(0, 700),
    raw: JSON.stringify(ev, null, 2),
    time: new Date(ev.createdAt).toLocaleTimeString(),
  };
}

function durationText(startedAt: string, completedAt?: string): string {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diff = Math.max(0, end - new Date(startedAt).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.46)',
  zIndex: 140,
  display: 'grid',
  placeItems: 'center',
  padding: 22,
};

const modalStyle: React.CSSProperties = {
  width: 'min(860px, 100%)',
  maxHeight: '88vh',
  overflow: 'auto',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 28px 90px rgba(0,0,0,.45)',
  padding: 16,
};

const panelStyle: React.CSSProperties = {
  background: 'rgba(var(--ov-color),0.045)',
  border: '1px solid rgba(var(--ov-color),0.09)',
  borderRadius: 8,
  padding: 11,
};

const rawStyle: React.CSSProperties = {
  margin: '8px 0 0',
  maxHeight: 160,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 10.5,
  color: 'var(--text-hint)',
  background: 'rgba(0,0,0,.24)',
  borderRadius: 6,
  padding: 8,
};
