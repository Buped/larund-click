// Tasks — everything Larund has done or is doing. Replaces the old separate
// Queue / Approvals / Notifications surfaces with one place: task runs, their
// evidence timeline, outputs, and any approval requests, with status + search.

import { useState } from 'react';
import { Icon } from '../icons';
import { listTaskRuns, listEvidence } from '../../lib/tasks/store';
import type { TaskRun, EvidenceEntry } from '../../lib/tasks/types';
import { listApprovalRequests, resolveApprovalRequest } from '../../lib/approvals/store';
import type { ApprovalRequestRecord } from '../../lib/approvals/types';
import { listQueueItems } from '../../lib/queue/store';
import type { TaskQueueItem } from '../../lib/queue/types';
import {
  PageFrame, PageHeader, Empty, Loading, ErrorBox, SearchInput, Badge,
  card, ghostBtn, btn, dangerBtn, labelStyle, statusColor, useAsyncList,
} from './ui';

const STATUS_FILTERS = ['all', 'running', 'waiting_approval', 'blocked', 'completed', 'failed'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function TaskDetail({ task, onBack }: { task: TaskRun; onBack: () => void }) {
  const evidence = useAsyncList<EvidenceEntry>(() => listEvidence(task.id), [task.id]);
  return (
    <div>
      <button style={{ ...ghostBtn, marginBottom: 12 }} onClick={onBack}><Icon name="arrowLeft" size={13} stroke={1.8} /> All tasks</button>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <strong style={{ fontSize: 15 }}>{task.title}</strong>
          <Badge text={task.status} color={statusColor(task.status)} />
        </div>
        {task.summary && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{task.summary}</div>}
        {task.error && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 6 }}>{task.error}</div>}
        <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 8 }}>{new Date(task.startedAt).toLocaleString()}</div>
        {task.outputRefs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>Outputs</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
              {task.outputRefs.map((o, i) => <Badge key={i} text={o.label} color="var(--accent)" />)}
            </div>
          </div>
        )}
      </div>

      <div style={{ ...labelStyle, margin: '6px 0 8px' }}>Evidence timeline</div>
      {evidence.loading && <Loading />}
      {evidence.items.map((ev) => (
        <div key={ev.id} style={{ ...card, borderLeft: `3px solid ${ev.success === false ? 'var(--danger)' : ev.success ? 'var(--success)' : 'var(--border-md)'}`, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>{ev.title}</strong>
            <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{ev.kind}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{ev.content}</div>
        </div>
      ))}
      {!evidence.loading && evidence.items.length === 0 && <Empty text="No evidence recorded for this task." icon="fileText" />}
    </div>
  );
}

export function TasksPage({ userId }: { userId: string }) {
  const tasks = useAsyncList<TaskRun>(() => listTaskRuns({ userId }), [userId]);
  const approvals = useAsyncList<ApprovalRequestRecord>(() => listApprovalRequests({ userId }), [userId]);
  const queue = useAsyncList<TaskQueueItem>(() => listQueueItems({ userId }), [userId]);
  const [selected, setSelected] = useState<TaskRun | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  if (selected) return <PageFrame><TaskDetail task={selected} onBack={() => setSelected(null)} /></PageFrame>;

  const pendingApprovals = approvals.items.filter((a) => a.status === 'pending');
  const activeQueue = queue.items.filter((q) => q.status === 'queued' || q.status === 'running' || q.status === 'waiting_approval');

  function matchesFilter(t: TaskRun): boolean {
    if (filter === 'all') return true;
    if (filter === 'running') return t.status === 'running';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed';
    if (filter === 'blocked') return t.status === 'blocked';
    if (filter === 'waiting_approval') return /approval|waiting/.test(t.status);
    return true;
  }
  const filtered = tasks.items.filter(matchesFilter).filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()));

  async function resolve(id: string, decision: 'approved_once' | 'approved_always' | 'denied') {
    await resolveApprovalRequest(id, decision);
    approvals.reload();
  }

  return (
    <PageFrame>
      <PageHeader title="Tasks" subtitle="Every run Larund performs is recorded with a verified evidence timeline." />

      {pendingApprovals.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warning)' }}>
          <strong style={{ fontSize: 13 }}>Pending approvals ({pendingApprovals.length})</strong>
          {pendingApprovals.map((a) => (
            <div key={a.id} style={{ ...card, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 12.5 }}>{a.actionName}</strong>
                <Badge text={a.risk} color="var(--warning)" />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{a.reason}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button style={btn} onClick={() => resolve(a.id, 'approved_once')}>Allow once</button>
                {!/external_send|destructive/.test(String(a.risk)) && <button style={ghostBtn} onClick={() => resolve(a.id, 'approved_always')}>Always</button>}
                <button style={dangerBtn} onClick={() => resolve(a.id, 'denied')}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeQueue.length > 0 && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, borderColor: 'rgba(74,158,255,.25)' }}>
          <span className="dot dot-blue dot-pulse" />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{activeQueue.length} task{activeQueue.length === 1 ? '' : 's'} queued or running in the background.</span>
        </div>
      )}

      <SearchInput value={query} onChange={setQuery} placeholder="Search tasks…" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...ghostBtn, ...(filter === f ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{f.replace('_', ' ')}</button>
        ))}
      </div>

      {tasks.loading && <Loading />}
      {tasks.error && <ErrorBox text={tasks.error} />}
      {!tasks.loading && filtered.map((t) => (
        <button key={t.id} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelected(t)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{t.title}</strong>
            <Badge text={t.status} color={statusColor(t.status)} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 5 }}>
            {new Date(t.startedAt).toLocaleString()} · {t.evidenceIds.length} evidence · {t.outputRefs.length} outputs
          </div>
        </button>
      ))}
      {!tasks.loading && !tasks.error && filtered.length === 0 && <Empty text="No tasks yet. Ask Larund to do something in Chat." icon="check" />}
    </PageFrame>
  );
}
