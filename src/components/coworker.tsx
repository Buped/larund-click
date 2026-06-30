// Coworker Core UI shell (Phase 1 + Phase 2). A tabbed screen exposing the
// customization layer: Workspaces, Memory (+ review queue), Skills (+ builder &
// suggestions), Workflows, Roles, Connections, Tasks and Audit/Doctor. Each tab
// has an explanation line and empty/loading/error states. Styling uses app CSS
// vars. No mouse/pixel control anywhere — this is all structured config.

import { useEffect, useState } from 'react';
import { Icon } from './icons';
import {
  archiveWorkspace,
  createWorkspace,
  listWorkspaces,
  updateWorkspace,
} from '../lib/workspaces/store';
import type { Workspace, WorkspaceKind, AutonomyMode } from '../lib/workspaces/types';
import { applyOnboarding, type GuardrailKey, type OnboardingPurpose } from '../lib/workspaces/onboarding';
import {
  acceptMemorySuggestion,
  archiveMemory,
  createMemory,
  deleteMemory,
  listMemory,
  listSuggestions,
  pinMemory,
  rejectMemorySuggestion,
} from '../lib/memory/store';
import type { MemoryEntry, MemoryType } from '../lib/memory/types';
import { listRichSkillManifests } from '../lib/skills/runner';
import {
  createBuilderSkill,
  deleteBuilderSkill,
  listBuilderSkills,
  setBuilderSkillEnabled,
} from '../lib/skills/builder/store';
import { dryRunSkill } from '../lib/skills/builder/test-runner';
import type { SkillBuilderSkill } from '../lib/skills/builder/types';
import type { ToolRisk } from '../lib/control-system/types';
import { BUILT_IN_ROLES } from '../lib/roles/templates';
import { listWorkflowTemplates } from '../lib/workflows/templates/store';
import type { WorkflowTemplate } from '../lib/workflows/templates/types';
import { listProviders } from '../lib/connections/hub/status';
import { listTaskRuns, listEvidence } from '../lib/tasks/store';
import type { TaskRun, EvidenceEntry } from '../lib/tasks/types';
import { runDoctor } from '../lib/doctor/run';
import type { DoctorReport } from '../lib/doctor/types';
import {
  ApprovalInboxTab,
  AutomationsTab,
  GatewayTab,
  NotificationsTab,
  TaskQueueTab,
} from './phase3';
import {
  CustomApiTab,
  LocalCatalogTab,
  McpHubTab,
  SandboxTab,
} from './phase4';

type Tab = 'workspaces' | 'memory' | 'skills' | 'workflows' | 'roles' | 'connections' | 'tasks' | 'automations' | 'queue' | 'approvals' | 'notifications' | 'gateway' | 'mcp' | 'customApi' | 'catalog' | 'sandbox' | 'audit';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'memory', label: 'Memory' },
  { id: 'skills', label: 'Skills' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'roles', label: 'Roles' },
  { id: 'connections', label: 'Connections' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'automations', label: 'Automations' },
  { id: 'queue', label: 'Queue' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'mcp', label: 'MCP Hub' },
  { id: 'customApi', label: 'Custom API' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'audit', label: 'Audit' },
];

const TAB_ICONS: Record<Tab, string> = {
  workspaces: 'folder',
  memory: 'fileText',
  skills: 'sparkle',
  workflows: 'play',
  roles: 'user',
  connections: 'link',
  tasks: 'check',
  automations: 'zap',
  queue: 'clock',
  approvals: 'shield',
  notifications: 'alert',
  gateway: 'message',
  mcp: 'cpu',
  customApi: 'globe',
  catalog: 'diamond',
  sandbox: 'lock',
  audit: 'search',
};

const TAB_GROUPS: Array<{ label: string; tabs: Tab[] }> = [
  { label: 'Setup', tabs: ['workspaces', 'roles'] },
  { label: 'Knowledge', tabs: ['memory', 'skills', 'workflows'] },
  { label: 'Execution', tabs: ['tasks', 'automations', 'queue', 'approvals', 'notifications'] },
  { label: 'Integrations', tabs: ['connections', 'gateway', 'mcp', 'customApi', 'catalog'] },
  { label: 'Safety', tabs: ['sandbox', 'audit'] },
];

const EXPLANATIONS: Record<Tab, string> = {
  workspaces: 'Workspaces shape Larund around one context (its roots, connections, skills, autonomy).',
  memory: 'Durable knowledge Larund uses. Review suggestions before they become active. Only active memory reaches the agent.',
  skills: 'Skills are structured, verified workflow modules. Build your own — Larund selects relevant ones per task.',
  workflows: 'Reusable task structures with steps + verification. Start one to guide a run.',
  roles: 'A role shapes how Larund approaches a task and which skills it prefers.',
  connections: 'External tool providers. Larund acts through these (no mouse), behind approval + audit.',
  tasks: 'Every run is recorded with an evidence timeline. Larund verifies before saying it is complete.',
  automations: 'Persistent one-shot, recurring, and event-triggered workflows with safety policies and visible runs.',
  queue: 'Background task queue for chat, automations, gateways, and manual work. One running task per workspace by default.',
  approvals: 'Persistent approval inbox for sensitive actions, including approvals from outside the main chat.',
  notifications: 'Task, approval, automation, connection, and memory events that Larund needs you to see.',
  gateway: 'Messaging gateway foundation. The local mock channel is available for testing delegated tasks and commands.',
  mcp: 'Secure MCP host/client hub. Third-party tools are scanned, scoped, approved, and audited before use.',
  customApi: 'Build simple REST API tools with risk classification, approval, and secret-safe audit.',
  catalog: 'Marketplace-ready local catalog for skills, packages, MCP servers, custom APIs, and workflows.',
  sandbox: 'Permission profiles that constrain filesystem, network, risk, credential, process, and send access.',
  audit: 'Diagnostics for the no-mouse coworker core and all Phase 1/2 systems.',
};

const card: React.CSSProperties = { background: 'var(--glass-panel)', border: '1px solid rgba(var(--ov-color),0.09)', borderRadius: 8, padding: 14, marginBottom: 10, boxShadow: '0 14px 34px rgba(0,0,0,0.18)' };
const btn: React.CSSProperties = { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 };
const ghostBtn: React.CSSProperties = { background: 'rgba(var(--ov-color),0.045)', color: 'var(--text-muted)', border: '1px solid rgba(var(--ov-color),0.09)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 };
const input: React.CSSProperties = { background: 'var(--bg-field)', border: '1px solid rgba(var(--ov-color),0.10)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' };

function statusColor(s: string): string {
  if (/pass|connected|configured|completed|active/.test(s)) return 'var(--success)';
  if (/warn|missing|blocked|needs|available|suggested|needs_review|drafting/.test(s)) return 'var(--warning)';
  if (/fail|error|cancelled|rejected/.test(s)) return 'var(--danger)';
  return 'var(--text-hint)';
}

function Explain({ tab }: { tab: Tab }) {
  return <div className="core-explain">{EXPLANATIONS[tab]}</div>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="core-empty">
      <span className="core-empty-icon"><Icon name="sparkle" size={16} stroke={1.6} /></span>
      <span>{text}</span>
    </div>
  );
}
function Loading() {
  return <div className="core-empty">Loading...</div>;
}
function ErrorBox({ text }: { text: string }) {
  return <div className="core-card core-card--danger" style={{ fontSize: 12.5 }}>Error: {text}</div>;
}

/** Hook: async list loader with loading/error states. */
function useAsyncList<T>(loader: () => Promise<T[]>, deps: unknown[]): {
  items: T[]; loading: boolean; error: string | null; reload: () => void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    loader().then(
      (r) => { if (alive) { setItems(r); setLoading(false); } },
      (e) => { if (alive) { setError(String(e)); setLoading(false); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { items, loading, error, reload: () => setTick((t) => t + 1) };
}

// ── Workspaces tab (+ onboarding wizard) ─────────────────────────────────────

function WorkspacesTab({ userId }: { userId: string }) {
  const { items, loading, error, reload } = useAsyncList<Workspace>(() => listWorkspaces(userId), [userId]);
  const [activeId, setActiveId] = useState<string | null>(localStorage.getItem('active_workspace_id'));
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WorkspaceKind>('project');
  const [onboarding, setOnboarding] = useState(false);

  async function add() {
    if (!name.trim()) return;
    await createWorkspace({ userId, name, kind });
    setName(''); reload();
  }
  function setActive(id: string) { localStorage.setItem('active_workspace_id', id); setActiveId(id); }
  async function setMode(ws: Workspace, mode: AutonomyMode) { await updateWorkspace(ws.id, { autonomyMode: mode }); reload(); }

  if (onboarding) return <OnboardingWizard userId={userId} onDone={() => { setOnboarding(false); reload(); }} onCancel={() => setOnboarding(false)} />;

  return (
    <div>
      <Explain tab="workspaces" />
      <div className="core-panel">
        <div className="core-panel-heading">
          <span className="core-panel-icon"><Icon name="folder" size={15} stroke={1.6} /></span>
          <div>
            <strong>New workspace</strong>
            <span>Give Larund one focused context for tools, memory, skills, and autonomy.</span>
          </div>
        </div>
        <div className="core-workspace-form">
          <div className="core-field">
            <div style={labelStyle}>Workspace name</div>
            <input style={input} value={name} placeholder="e.g. Marketing Client" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          </div>
          <div className="core-field">
            <div style={labelStyle}>Kind</div>
            <select style={input} value={kind} onChange={e => setKind(e.target.value as WorkspaceKind)}>
              {['personal', 'company', 'client', 'project', 'custom'].map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="core-actions">
            <button style={btn} onClick={add}><Icon name="plus" size={13} stroke={2} /> Create</button>
            <button style={ghostBtn} onClick={() => setOnboarding(true)}>Guided setup</button>
          </div>
        </div>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {!loading && !error && items.map(ws => (
        <div key={ws.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{ws.name}</strong>
              <span className="core-badge">{ws.kind}</span>
              {activeId === ws.id && <span className="core-badge core-badge--success"><span className="dot dot-green" /> active</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {activeId !== ws.id && <button style={ghostBtn} onClick={() => setActive(ws.id)}>Set active</button>}
              <button style={ghostBtn} onClick={() => archiveWorkspace(ws.id).then(reload)}>Archive</button>
            </div>
          </div>
          {ws.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{ws.description}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <span style={labelStyle}>Autonomy</span>
            {(['manual', 'semi', 'full'] as AutonomyMode[]).map(m => (
              <button key={m} onClick={() => setMode(ws, m)}
                style={{ ...ghostBtn, ...(ws.autonomyMode === m ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}) }}>
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No workspaces yet. Create one or run guided setup." />}
    </div>
  );
}

const PURPOSES: OnboardingPurpose[] = ['development', 'marketing', 'operations', 'admin', 'client', 'finance', 'research', 'custom'];
const GUARDRAILS: GuardrailKey[] = ['send_messages', 'delete_files', 'modify_production_code', 'publish', 'run_shell', 'spend_money'];
const TOOL_OPTIONS = ['google-workspace', 'github', 'notion', 'slack', 'hubspot', 'airtable', 'wordpress'];

function OnboardingWizard({ userId, onDone, onCancel }: { userId: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<OnboardingPurpose>('marketing');
  const [tools, setTools] = useState<string[]>(['google-workspace']);
  const [helpWith, setHelpWith] = useState('write reports, create marketing content');
  const [guards, setGuards] = useState<GuardrailKey[]>(['send_messages', 'publish']);
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle<T>(arr: T[], v: T, set: (x: T[]) => void) { set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]); }

  async function finish() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await applyOnboarding({
        userId, workspaceName: name, purpose, tools,
        helpWith: helpWith.split(',').map(s => s.trim()).filter(Boolean),
        neverWithoutApproval: guards, styleNotes: style,
      });
      localStorage.setItem('active_workspace_id', result.workspace.id);
      if (result.plan.suggestedRoleId) localStorage.setItem('active_role_id', result.plan.suggestedRoleId);
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button style={{ ...ghostBtn, marginBottom: 10 }} onClick={onCancel}>← Cancel</button>
      <div style={card}>
        <strong style={{ fontSize: 14 }}>Guided workspace setup</strong>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>Configures memory, skills, connections and autonomy for your work.</div>
      </div>
      <div style={card}>
        <div style={labelStyle}>1. Workspace name</div>
        <input style={{ ...input, marginTop: 4 }} value={name} placeholder="e.g. Marketing Client" onChange={e => setName(e.target.value)} />
      </div>
      <div style={card}>
        <div style={labelStyle}>2. What is this workspace for?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {PURPOSES.map(p => <button key={p} onClick={() => setPurpose(p)} style={{ ...ghostBtn, ...(purpose === p ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}) }}>{p}</button>)}
        </div>
      </div>
      <div style={card}>
        <div style={labelStyle}>3. What tools do you use?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {TOOL_OPTIONS.map(t => <button key={t} onClick={() => toggle(tools, t, setTools)} style={{ ...ghostBtn, ...(tools.includes(t) ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}) }}>{t}</button>)}
        </div>
      </div>
      <div style={card}>
        <div style={labelStyle}>4. What should Larund help with?</div>
        <input style={{ ...input, marginTop: 4 }} value={helpWith} onChange={e => setHelpWith(e.target.value)} />
      </div>
      <div style={card}>
        <div style={labelStyle}>5. Never without approval</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {GUARDRAILS.map(g => <button key={g} onClick={() => toggle(guards, g, setGuards)} style={{ ...ghostBtn, ...(guards.includes(g) ? { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' } : {}) }}>{g.replace(/_/g, ' ')}</button>)}
        </div>
      </div>
      <div style={card}>
        <div style={labelStyle}>6. Style & preferences</div>
        <textarea style={{ ...input, marginTop: 4, minHeight: 50, resize: 'vertical' }} value={style} placeholder="e.g. Prefer specific, punchy copy. No generic AI filler." onChange={e => setStyle(e.target.value)} />
      </div>
      <button style={btn} onClick={finish} disabled={busy || !name.trim()}>{busy ? 'Setting up…' : 'Create workspace & seed memory'}</button>
    </div>
  );
}

// ── Memory tab (+ review queue) ──────────────────────────────────────────────

const MEMORY_TYPES: MemoryType[] = ['preference', 'correction', 'procedural', 'project', 'workspace', 'user_profile', 'evidence', 'episodic'];

function MemoryTab({ userId }: { userId: string }) {
  const [query, setQuery] = useState('');
  const { items, loading, error, reload } = useAsyncList<MemoryEntry>(() => listMemory({ userId, query: query || undefined }), [userId, query]);
  const suggestions = useAsyncList<MemoryEntry>(() => listSuggestions(userId), [userId]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('preference');

  async function add() {
    if (!title.trim() || !content.trim()) return;
    await createMemory({ userId, type, title, content, source: 'user' });
    setTitle(''); setContent(''); reload();
  }
  function reloadAll() { reload(); suggestions.reload(); }

  return (
    <div>
      <Explain tab="memory" />

      {suggestions.items.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warning)' }}>
          <strong style={{ fontSize: 13 }}>Review queue ({suggestions.items.length})</strong>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', margin: '4px 0 8px' }}>Suggested by completed tasks. Accept to make active, or reject.</div>
          {suggestions.items.map(s => (
            <div key={s.id} style={{ ...card, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 12.5 }}>{s.title}</strong>
                <span style={{ fontSize: 10.5, color: statusColor(s.status) }}>{s.type} · {s.status}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.content}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => acceptMemorySuggestion(s.id).then(reloadAll)}>Accept</button>
                <button style={{ ...ghostBtn, color: 'var(--danger)' }} onClick={() => rejectMemorySuggestion(s.id).then(reloadAll)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
          <select style={{ ...input, width: 140 }} value={type} onChange={e => setType(e.target.value as MemoryType)}>
            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <textarea style={{ ...input, minHeight: 50, resize: 'vertical' }} placeholder="What should the agent remember?" value={content} onChange={e => setContent(e.target.value)} />
        <div style={{ marginTop: 8 }}><button style={btn} onClick={add}>Add memory</button></div>
      </div>

      <input style={{ ...input, marginBottom: 10 }} placeholder="Search active memory…" value={query} onChange={e => setQuery(e.target.value)} />

      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {!loading && !error && items.map(m => (
        <div key={m.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {m.pinned && <span title="pinned">📌</span>}
              <strong style={{ fontSize: 13 }}>{m.title}</strong>
              <span style={{ fontSize: 10.5, color: 'var(--text-hint)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>{m.type} · {m.scope}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={ghostBtn} onClick={() => pinMemory(m.id, !m.pinned).then(reload)}>{m.pinned ? 'Unpin' : 'Pin'}</button>
              <button style={ghostBtn} onClick={() => archiveMemory(m.id).then(reload)}>Archive</button>
              <button style={{ ...ghostBtn, color: 'var(--danger)' }} onClick={() => deleteMemory(m.id).then(reload)}>Delete</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>{m.content}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 6 }}>
            source: {m.source} · confidence: {Math.round(m.confidence * 100)}%
            {m.sensitivity !== 'normal' ? ` · ${m.sensitivity}` : ''}
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No active memory. Add one above, or accept a suggestion." />}
    </div>
  );
}

// ── Skills tab (+ builder + suggestions) ─────────────────────────────────────

const RISK_OPTIONS: ToolRisk[] = ['read_only', 'local_write', 'external_read', 'external_write', 'external_send', 'destructive', 'process_exec'];

function SkillsTab({ userId }: { userId: string }) {
  const bundled = listRichSkillManifests();
  const workspaceId = localStorage.getItem('active_workspace_id') ?? undefined;
  const custom = useAsyncList<SkillBuilderSkill>(() => listBuilderSkills({ userId, workspaceId, includeSuggested: true }), [userId]);
  const [building, setBuilding] = useState(false);

  if (building) return <SkillBuilderForm userId={userId} workspaceId={workspaceId} onDone={() => { setBuilding(false); custom.reload(); }} onCancel={() => setBuilding(false)} />;

  const suggested = custom.items.filter(s => s.source === 'suggested');
  const installed = custom.items.filter(s => s.source !== 'suggested');

  return (
    <div>
      <Explain tab="skills" />
      <div style={{ marginBottom: 10 }}><button style={btn} onClick={() => setBuilding(true)}>+ New skill</button></div>

      {suggested.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warning)' }}>
          <strong style={{ fontSize: 13 }}>Suggested skills ({suggested.length})</strong>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', margin: '4px 0' }}>Inferred from repeated tasks. Enable to install, or delete.</div>
          {suggested.map(s => (
            <div key={s.id} style={{ ...card, marginBottom: 8 }}>
              <strong style={{ fontSize: 12.5 }}>{s.name}</strong>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => setBuilderSkillEnabled(s.id, true).then(custom.reload)}>Install</button>
                <button style={{ ...ghostBtn, color: 'var(--danger)' }} onClick={() => deleteBuilderSkill(s.id).then(custom.reload)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {installed.length > 0 && <div style={labelStyle}>Your skills</div>}
      {installed.map(s => <CustomSkillRow key={s.id} skill={s} workspaceId={workspaceId} onChange={custom.reload} />)}

      <div style={{ ...labelStyle, marginTop: 8 }}>Built-in skills</div>
      {bundled.map(s => (
        <div key={s.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 13 }}>{s.name}</strong>
            <span style={{ fontSize: 10.5, color: statusColor(s.risk), border: `1px solid ${statusColor(s.risk)}`, borderRadius: 5, padding: '1px 6px' }}>{s.risk}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>v{s.version} · {s.categories.join(', ')} · tools: {s.allowedTools.join(', ') || 'none'}</div>
          {s.requiredConnections.length > 0 && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>needs: {s.requiredConnections.join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

function CustomSkillRow({ skill, workspaceId, onChange }: { skill: SkillBuilderSkill; workspaceId?: string; onChange: () => void }) {
  const [test, setTest] = useState<string | null>(null);
  function runTest() {
    const r = dryRunSkill(skill, { availableConnectionIds: skill.requiredConnections, prompt: skill.examplePrompts[0] });
    setTest(r.ok ? `Dry run OK. ${r.warnings.join(' ') || 'No warnings.'} (execution needs approval)` : `Issues: ${r.errors.join('; ')}`);
  }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>{skill.name}</strong>
          <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{skill.source} · v{skill.version}</span>
          <span style={{ fontSize: 10.5, color: statusColor(skill.enabled ? 'active' : 'disabled') }}>{skill.enabled ? '● enabled' : '○ disabled'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={ghostBtn} onClick={runTest}>Test</button>
          <button style={ghostBtn} onClick={() => setBuilderSkillEnabled(skill.id, !skill.enabled).then(onChange)}>{skill.enabled ? 'Disable' : 'Enable'}</button>
          <button style={{ ...ghostBtn, color: 'var(--danger)' }} onClick={() => deleteBuilderSkill(skill.id).then(onChange)}>Delete</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{skill.description}</div>
      <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>
        {skill.riskLevel} · tools: {skill.allowedTools.join(', ') || 'none'}{skill.requiredConnections.length ? ` · needs: ${skill.requiredConnections.join(', ')}` : ''}
        {workspaceId && skill.workspaceId === workspaceId ? ' · this workspace' : ''}
      </div>
      {test && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, padding: 8, background: 'var(--bg-input)', borderRadius: 6 }}>{test}</div>}
    </div>
  );
}

function SkillBuilderForm({ userId, workspaceId, onDone, onCancel }: { userId: string; workspaceId?: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggers, setTriggers] = useState('');
  const [tools, setTools] = useState('');
  const [connections, setConnections] = useState('');
  const [risk, setRisk] = useState<ToolRisk>('local_write');
  const [steps, setSteps] = useState('');
  const [verification, setVerification] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !description.trim()) { setErr('Name and description are required.'); return; }
    if (!workspaceId) { setErr('Choose or create a workspace before creating skills.'); return; }
    setBusy(true); setErr(null);
    try {
      await createBuilderSkill({
        userId, workspaceId, name, description,
        triggerPhrases: triggers.split(',').map(s => s.trim()).filter(Boolean),
        allowedTools: tools.split(',').map(s => s.trim()).filter(Boolean),
        requiredConnections: connections.split(',').map(s => s.trim()).filter(Boolean),
        riskLevel: risk,
        steps: steps.split('\n').map(s => s.trim()).filter(Boolean).map((line, i) => {
          const [title, ...rest] = line.split(':');
          return { id: `st${i}`, title: title.trim(), instruction: rest.join(':').trim() || title.trim(), preferredTools: [], required: true };
        }),
        verificationChecklist: verification.split('\n').map(s => s.trim()).filter(Boolean).map((line, i) => ({
          id: `v${i}`, title: line, description: line, kind: 'read_back' as const, required: true,
        })),
      });
      onDone();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally { setBusy(false); }
  }

  const field = (lbl: string, node: React.ReactNode) => (
    <div style={card}><div style={labelStyle}>{lbl}</div><div style={{ marginTop: 4 }}>{node}</div></div>
  );

  return (
    <div>
      <button style={{ ...ghostBtn, marginBottom: 10 }} onClick={onCancel}>← Cancel</button>
      <div style={card}><strong style={{ fontSize: 14 }}>New skill</strong><div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>Compiles into a verified, no-mouse skill Larund can select per task.</div></div>
      {field('Name & goal', <input style={input} value={name} placeholder="Client Weekly Report" onChange={e => setName(e.target.value)} />)}
      {field('Description', <input style={input} value={description} placeholder="Compile a weekly client report from sheets" onChange={e => setDescription(e.target.value)} />)}
      {field('Trigger phrases (comma-separated)', <input style={input} value={triggers} placeholder="weekly report, client report" onChange={e => setTriggers(e.target.value)} />)}
      {field('Allowed tools (comma-separated)', <input style={input} value={tools} placeholder="sheet.read, file.write, connection.call" onChange={e => setTools(e.target.value)} />)}
      {field('Required connections (comma-separated)', <input style={input} value={connections} placeholder="google-workspace" onChange={e => setConnections(e.target.value)} />)}
      {field('Risk', <select style={input} value={risk} onChange={e => setRisk(e.target.value as ToolRisk)}>{RISK_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}</select>)}
      {field('Steps (one per line, "Title: instruction")', <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={steps} placeholder={'Read data: read the sales sheet\nWrite report: write a markdown report'} onChange={e => setSteps(e.target.value)} />)}
      {field('Verification checklist (one per line)', <textarea style={{ ...input, minHeight: 50, resize: 'vertical' }} value={verification} placeholder={'Report file exists and was read back'} onChange={e => setVerification(e.target.value)} />)}
      {err && <ErrorBox text={err} />}
      <button style={btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save & install skill'}</button>
    </div>
  );
}

// ── Workflows tab ────────────────────────────────────────────────────────────

function WorkflowsTab({ userId }: { userId: string }) {
  const workspaceId = localStorage.getItem('active_workspace_id') ?? undefined;
  const { items, loading, error } = useAsyncList<WorkflowTemplate>(() => listWorkflowTemplates({ userId, workspaceId }), [userId]);
  const [started, setStarted] = useState<string | null>(null);

  function start(t: WorkflowTemplate) {
    // Set the active workflow for the next chat run; the agent loop injects its
    // steps + verification into the prompt and records the template id.
    localStorage.setItem('active_workflow_template_id', t.id);
    setStarted(t.name);
  }

  return (
    <div>
      <Explain tab="workflows" />
      {started && <div style={{ ...card, borderColor: 'var(--success)', color: 'var(--success)', fontSize: 12.5 }}>“{started}” is armed. Open Chat and describe the task — Larund will follow these steps and verify.</div>}
      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {!loading && !error && items.map(t => (
        <div key={t.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 13 }}>{t.name}</strong>
            <button style={btn} onClick={() => start(t)}>Start</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>
            {t.steps.length} steps · {t.verification.length} checks{t.requiredConnections.length ? ` · needs: ${t.requiredConnections.join(', ')}` : ''}
            {t.source !== 'builtin' ? ` · ${t.source}` : ''}
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No workflow templates." />}
    </div>
  );
}

// ── Roles tab ────────────────────────────────────────────────────────────────

function RolesTab() {
  const [activeRole, setActiveRole] = useState<string | null>(localStorage.getItem('active_role_id'));
  function setRole(id: string) {
    if (activeRole === id) { localStorage.removeItem('active_role_id'); setActiveRole(null); }
    else { localStorage.setItem('active_role_id', id); setActiveRole(id); }
  }
  return (
    <div>
      <Explain tab="roles" />
      {BUILT_IN_ROLES.map(r => (
        <div key={r.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{r.name}</strong>
              {activeRole === r.id && <span style={{ fontSize: 10.5, color: 'var(--success)' }}>● active</span>}
            </div>
            <button style={{ ...ghostBtn, ...(activeRole === r.id ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}) }} onClick={() => setRole(r.id)}>
              {activeRole === r.id ? 'Active' : 'Use role'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{r.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>skills: {r.defaultSkills.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}

// ── Connections tab ──────────────────────────────────────────────────────────

function ConnectionsTab() {
  const providers = listProviders();
  return (
    <div>
      <Explain tab="connections" />
      {providers.map(p => (
        <div key={p.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{p.name}</strong>
              <span style={{ fontSize: 10.5, color: 'var(--text-hint)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>{p.category}</span>
            </div>
            <span style={{ fontSize: 11, color: statusColor(p.status) }}>● {p.status.replace('_', ' ')}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{p.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>auth: {p.authType} · {p.tools.length} tools</div>
          {p.status === 'missing_auth' && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>Missing auth — set {p.envVars.join(', ') || 'credentials'} in Settings.</div>}
        </div>
      ))}
    </div>
  );
}

// ── Tasks tab ────────────────────────────────────────────────────────────────

function TasksTab({ userId }: { userId: string }) {
  const { items, loading, error } = useAsyncList<TaskRun>(() => listTaskRuns({ userId }), [userId]);
  const [selected, setSelected] = useState<TaskRun | null>(null);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([]);

  async function open(task: TaskRun) { setSelected(task); setEvidence(await listEvidence(task.id)); }

  if (selected) {
    return (
      <div>
        <button style={{ ...ghostBtn, marginBottom: 10 }} onClick={() => setSelected(null)}>← Back to tasks</button>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{selected.title}</strong>
            <span style={{ color: statusColor(selected.status), fontSize: 12 }}>{selected.status}</span>
          </div>
          {selected.summary && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{selected.summary}</div>}
          {selected.error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{selected.error}</div>}
          {selected.outputRefs.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>Outputs: {selected.outputRefs.map(o => o.label).join(', ')}</div>}
        </div>
        <div style={labelStyle}>Evidence timeline</div>
        {evidence.map(ev => (
          <div key={ev.id} style={{ ...card, borderLeft: `3px solid ${ev.success === false ? 'var(--danger)' : ev.success ? 'var(--success)' : 'var(--border-md)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 12 }}>{ev.title}</strong>
              <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{ev.kind}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{ev.content}</div>
          </div>
        ))}
        {evidence.length === 0 && <Empty text="No evidence recorded for this task." />}
      </div>
    );
  }

  return (
    <div>
      <Explain tab="tasks" />
      {loading && <Loading />}
      {error && <ErrorBox text={error} />}
      {!loading && !error && items.map(t => (
        <button key={t.id} style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(t)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 13 }}>{t.title}</strong>
            <span style={{ color: statusColor(t.status), fontSize: 11.5 }}>{t.status}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginTop: 4 }}>
            {new Date(t.startedAt).toLocaleString()} · {t.evidenceIds.length} evidence · {t.outputRefs.length} outputs
          </div>
        </button>
      ))}
      {!loading && !error && items.length === 0 && <Empty text="No task runs yet. Run a task from Chat." />}
    </div>
  );
}

// ── Audit / Doctor tab ───────────────────────────────────────────────────────

function AuditTab() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState(false);
  async function run() { setRunning(true); try { setReport(await runDoctor('unknown')); } finally { setRunning(false); } }
  useEffect(() => { void run(); }, []);
  return (
    <div>
      <Explain tab="audit" />
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ fontSize: 13 }}>Larund Doctor</strong>
          {report && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 3 }}>{report.summary.pass} pass · {report.summary.warn} warn · {report.summary.fail} fail</div>}
        </div>
        <button style={btn} onClick={run} disabled={running}>{running ? 'Running…' : 'Run diagnostics'}</button>
      </div>
      {!report && <Loading />}
      {report?.checks.map(c => (
        <div key={c.id} style={{ ...card, borderLeft: `3px solid ${statusColor(c.status)}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 12.5 }}>{c.label}</strong>
            <span style={{ color: statusColor(c.status), fontSize: 11.5, textTransform: 'uppercase' }}>{c.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{c.detail}</div>
          {c.remedy && c.status !== 'pass' && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>→ {c.remedy}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function CoworkerScreen({ nav, userId }: { nav: (s: string) => void; userId: string | null }) {
  const [tab, setTab] = useState<Tab>('workspaces');
  const uid = userId ?? 'local';
  const activeTab = TABS.find(t => t.id === tab) ?? TABS[0];

  return (
    <div className="core-main">
      <header className="core-header">
        <button className="core-back-btn" onClick={() => nav('chat')} title="Back to Chat">
          <Icon name="arrowLeft" size={14} stroke={1.8} />
          <span>Chat</span>
        </button>
        <div className="core-title-wrap">
          <span className="core-title-icon"><Icon name="cpu" size={17} stroke={1.7} /></span>
          <div>
            <h1>Coworker Core</h1>
            <p>{activeTab.label}</p>
          </div>
        </div>
        <div className="core-header-chips">
          <span className="core-badge core-badge--success"><span className="dot dot-green" /> verified</span>
          <span className="core-badge"><Icon name="shield" size={11} stroke={1.8} /> no mouse</span>
          <span className="core-badge"><Icon name="sparkle" size={11} stroke={1.8} /> customizable</span>
        </div>
      </header>

      <div className="core-shell">
        <nav className="core-rail" aria-label="Coworker Core sections">
          {TAB_GROUPS.map(group => (
            <div className="core-rail-group" key={group.label}>
              <div className="core-rail-label">{group.label}</div>
              {group.tabs.map(tabId => {
                const t = TABS.find(item => item.id === tabId)!;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    className={`core-tab${active ? ' core-tab--active' : ''}`}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon name={TAB_ICONS[t.id]} size={14} stroke={1.7} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="core-content scroll">
          <div className="core-content-inner">
            {tab === 'workspaces' && <WorkspacesTab userId={uid} />}
            {tab === 'memory' && <MemoryTab userId={uid} />}
            {tab === 'skills' && <SkillsTab userId={uid} />}
            {tab === 'workflows' && <WorkflowsTab userId={uid} />}
            {tab === 'roles' && <RolesTab />}
            {tab === 'connections' && <ConnectionsTab />}
            {tab === 'tasks' && <TasksTab userId={uid} />}
            {tab === 'automations' && <AutomationsTab userId={uid} />}
            {tab === 'queue' && <TaskQueueTab userId={uid} />}
            {tab === 'approvals' && <ApprovalInboxTab userId={uid} />}
            {tab === 'notifications' && <NotificationsTab userId={uid} />}
            {tab === 'gateway' && <GatewayTab userId={uid} />}
            {tab === 'mcp' && <McpHubTab userId={uid} />}
            {tab === 'customApi' && <CustomApiTab userId={uid} />}
            {tab === 'catalog' && <LocalCatalogTab userId={uid} />}
            {tab === 'sandbox' && <SandboxTab />}
            {tab === 'audit' && <AuditTab />}
          </div>
        </main>
      </div>
    </div>
  );
}
