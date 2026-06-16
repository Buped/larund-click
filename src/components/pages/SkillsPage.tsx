// Skills — "Teach Larund reusable ways to work." A directory of built-in,
// user-created, and suggested skills, plus Personas (former Roles) and the user's
// reusable Workflows. The skill runner, role prompts, and workflow templates are
// all preserved; this is a friendlier surface over them.

import { useState } from 'react';
import { Icon } from '../icons';
import { listRichSkillManifests } from '../../lib/skills/runner';
import { listBuilderSkills, createBuilderSkill, deleteBuilderSkill, setBuilderSkillEnabled } from '../../lib/skills/builder/store';
import type { SkillBuilderSkill } from '../../lib/skills/builder/types';
import type { ToolRisk } from '../../lib/control-system/types';
import { BUILT_IN_ROLES } from '../../lib/roles/templates';
import { listWorkflowTemplates } from '../../lib/workflows/templates/store';
import type { WorkflowTemplate } from '../../lib/workflows/templates/types';
import { listProviders } from '../../lib/connections/hub/status';
import {
  PageFrame, PageHeader, Empty, Tabs, SearchInput, Badge,
  card, btn, ghostBtn, dangerBtn, input, labelStyle, statusColor, useAsyncList, getActiveWorkspaceId,
} from './ui';

const RISK_OPTIONS: ToolRisk[] = ['read_only', 'local_write', 'external_read', 'external_write', 'external_send', 'destructive', 'process_exec'];

// ── Create Skill wizard (friendlier than the old developer form) ──────────────

function CreateSkill({ userId, onDone, onCancel }: { userId: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggers, setTriggers] = useState('');
  const [instructionBody, setInstructionBody] = useState('');
  const [steps, setSteps] = useState('');
  const [tools, setTools] = useState('');
  const [connections, setConnections] = useState('');
  const [verification, setVerification] = useState('');
  const [risk, setRisk] = useState<ToolRisk>('local_write');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim() || !description.trim()) { setErr('Give the skill a name and a short description.'); return; }
    setBusy(true); setErr('');
    try {
      await createBuilderSkill({
        userId, workspaceId: getActiveWorkspaceId(), name, description,
        instructionBody,
        triggerPhrases: triggers.split(',').map((s) => s.trim()).filter(Boolean),
        allowedTools: tools.split(',').map((s) => s.trim()).filter(Boolean),
        requiredConnections: connections.split(',').map((s) => s.trim()).filter(Boolean),
        riskLevel: risk,
        steps: steps.split('\n').map((s) => s.trim()).filter(Boolean).map((line, i) => {
          const [title, ...rest] = line.split(':');
          return { id: `st${i}`, title: title.trim(), instruction: rest.join(':').trim() || title.trim(), preferredTools: [], required: true };
        }),
        verificationChecklist: verification.split('\n').map((s) => s.trim()).filter(Boolean).map((line, i) => ({ id: `v${i}`, title: line, description: line, kind: 'read_back' as const, required: true })),
      });
      onDone();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } finally { setBusy(false); }
  }

  const Q = ({ q, hint, children }: { q: string; hint?: string; children: React.ReactNode }) => (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{q}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', margin: '3px 0 8px' }}>{hint}</div>}
      <div style={{ marginTop: hint ? 0 : 8 }}>{children}</div>
    </div>
  );

  return (
    <PageFrame>
      <button style={{ ...ghostBtn, marginBottom: 12 }} onClick={onCancel}><Icon name="arrowLeft" size={13} stroke={1.8} /> Skills</button>
      <PageHeader title="New skill" subtitle="Answer a few questions — Larund compiles a verified, no-mouse skill it can pick per task." />
      <Q q="What should this skill help with?"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly client report" /></Q>
      <Q q="Describe it in one line"><input style={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Compile a weekly client report from a spreadsheet" /></Q>
      <Q q="When should Larund use it?" hint="Comma-separated phrases that should trigger this skill."><input style={input} value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder="weekly report, client report" /></Q>
      <Q q="Write the full instructions Larund should follow" hint="Long-form markdown. This is the heart of the skill — Larund loads it verbatim when the skill is selected.">
        <textarea style={{ ...input, minHeight: 180, resize: 'vertical', fontFamily: 'var(--font-mono)', lineHeight: 1.55 }} value={instructionBody} onChange={(e) => setInstructionBody(e.target.value)} placeholder={'## Goal\nProduce a weekly client report.\n\n## Approach\n1. Pull the latest numbers from the source sheet.\n2. Summarize wins, risks, and next steps in clear prose.\n3. Save the report and read it back to verify.\n\n## Style\nConcise, specific, no filler.'} />
      </Q>
      <Q q="Optional: short step checklist" hint='One per line, as "Title: instruction". Larund uses these alongside the instructions above.'><textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Read data: read the sales sheet\nWrite report: write a markdown report'} /></Q>
      <Q q="What tools & connections may it use?" hint="Optional. Comma-separated.">
        <input style={{ ...input, marginBottom: 8 }} value={tools} onChange={(e) => setTools(e.target.value)} placeholder="tools: sheet.read, file.write" />
        <input style={input} value={connections} onChange={(e) => setConnections(e.target.value)} placeholder="connections: google-workspace" />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {RISK_OPTIONS.map((r) => <button key={r} onClick={() => setRisk(r)} style={{ ...ghostBtn, ...(risk === r ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }}>{r}</button>)}
        </div>
      </Q>
      <Q q="How should Larund verify the result?" hint="One check per line. Larund won't say it's done until these pass."><textarea style={{ ...input, minHeight: 54, resize: 'vertical' }} value={verification} onChange={(e) => setVerification(e.target.value)} placeholder={'Report file exists and was read back'} /></Q>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{err}</div>}
      <button style={btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save skill'}</button>
    </PageFrame>
  );
}

// Which required connections of a skill are not configured yet, so the card can
// surface a "Needs connection" blocker (Connections + Skills integration).
function missingConnections(required: string[]): string[] {
  if (required.length === 0) return [];
  const providers = listProviders();
  return required.filter((id) => {
    const p = providers.find((x) => x.id === id);
    return !p || p.status !== 'configured';
  });
}

function UserSkillCard({ skill: s, onChange }: { skill: SkillBuilderSkill; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const missing = missingConnections(s.requiredConnections);
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>{s.name}</strong>
          <Badge text={s.enabled ? 'Enabled' : 'Disabled'} color={statusColor(s.enabled ? 'enabled' : 'disabled')} />
          {missing.length > 0 && <Badge text={`Needs ${missing.join(', ')}`} color="var(--warning)" />}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={ghostBtn} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'View'}</button>
          <button style={ghostBtn} onClick={() => setBuilderSkillEnabled(s.id, !s.enabled).then(onChange)}>{s.enabled ? 'Disable' : 'Enable'}</button>
          <button style={dangerBtn} onClick={() => deleteBuilderSkill(s.id).then(onChange)}>Delete</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>
      <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>{s.riskLevel}{s.requiredConnections.length ? ` · needs: ${s.requiredConnections.join(', ')}` : ''}</div>
      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {s.triggerPhrases.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginBottom: 8 }}><strong style={{ color: 'var(--text-muted)' }}>Triggers:</strong> {s.triggerPhrases.join(', ')}</div>}
          <div style={{ ...labelStyle, marginBottom: 5 }}>Instructions</div>
          <pre style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55, background: 'rgba(0,0,0,.25)', borderRadius: 7, padding: '10px 12px', margin: 0, fontFamily: 'var(--font-mono)', maxHeight: 320, overflow: 'auto' }}>
            {s.instructionBody?.trim() || '(No long-form instructions — this skill relies on its steps + verification.)'}
          </pre>
          {s.verificationChecklist.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ ...labelStyle, marginBottom: 5 }}>Verification</div>
              {s.verificationChecklist.map((v) => <div key={v.id} style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>• {v.title}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function SkillsTab({ userId }: { userId: string }) {
  const bundled = listRichSkillManifests();
  const custom = useAsyncList<SkillBuilderSkill>(() => listBuilderSkills({ userId, workspaceId: getActiveWorkspaceId(), includeSuggested: true }), [userId]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  if (creating) return <CreateSkill userId={userId} onDone={() => { setCreating(false); custom.reload(); }} onCancel={() => setCreating(false)} />;

  const suggested = custom.items.filter((s) => s.source === 'suggested');
  const installed = custom.items.filter((s) => s.source !== 'suggested');
  const match = (s: string) => !query || s.toLowerCase().includes(query.toLowerCase());

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><SearchInput value={query} onChange={setQuery} placeholder="Search skills…" /></div>
        <button style={{ ...btn, height: 36 }} onClick={() => setCreating(true)}><Icon name="plus" size={13} stroke={2} /> New skill</button>
      </div>

      {suggested.length > 0 && (
        <>
          <div style={{ ...labelStyle, margin: '4px 0 8px' }}>Suggested</div>
          {suggested.filter((s) => match(s.name)).map((s) => (
            <div key={s.id} style={{ ...card, borderColor: 'var(--warning)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
                <Badge text="Suggested" color="var(--warning)" />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => setBuilderSkillEnabled(s.id, true).then(custom.reload)}>Add skill</button>
                <button style={dangerBtn} onClick={() => deleteBuilderSkill(s.id).then(custom.reload)}>Dismiss</button>
              </div>
            </div>
          ))}
        </>
      )}

      {installed.length > 0 && <div style={{ ...labelStyle, margin: '8px 0' }}>Created by you</div>}
      {installed.filter((s) => match(s.name)).map((s) => (
        <UserSkillCard key={s.id} skill={s} onChange={custom.reload} />
      ))}

      <div style={{ ...labelStyle, margin: '12px 0 8px' }}>Built-in</div>
      {bundled.filter((s) => match(s.name)).map((s) => (
        <div key={s.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{s.name}</strong>
            <Badge text={s.risk} color={statusColor(s.risk)} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>{s.categories.join(', ')}{s.requiredConnections.length ? ` · needs: ${s.requiredConnections.join(', ')}` : ''}</div>
        </div>
      ))}
    </>
  );
}

function PersonasTab() {
  const [activeRole, setActiveRole] = useState<string | null>(localStorage.getItem('active_role_id'));
  function setRole(id: string) {
    if (activeRole === id) { localStorage.removeItem('active_role_id'); setActiveRole(null); }
    else { localStorage.setItem('active_role_id', id); setActiveRole(id); }
  }
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12 }}>A persona shapes how Larund approaches a task and which skills it prefers. Pick one to apply it to your next tasks.</div>
      {BUILT_IN_ROLES.map((r) => (
        <div key={r.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{r.name}</strong>
              {activeRole === r.id && <Badge text="Active" color="var(--success)" />}
            </div>
            <button style={{ ...ghostBtn, ...(activeRole === r.id ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }} onClick={() => setRole(r.id)}>{activeRole === r.id ? 'Active' : 'Use persona'}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{r.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>skills: {r.defaultSkills.join(', ') || '—'}</div>
        </div>
      ))}
    </>
  );
}

function WorkflowsTab({ userId }: { userId: string }) {
  const wf = useAsyncList<WorkflowTemplate>(() => listWorkflowTemplates({ userId, workspaceId: getActiveWorkspaceId() }), [userId]);
  const [armed, setArmed] = useState<string | null>(null);
  // Only show user-created workflows in the normal UI — built-in templates stay
  // available to the agent internally but don't clutter this list.
  const userWorkflows = wf.items.filter((t) => t.source !== 'builtin');

  function arm(t: WorkflowTemplate) { localStorage.setItem('active_workflow_template_id', t.id); setArmed(t.name); }

  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12 }}>Workflows are your reusable step-by-step jobs. Arm one, then describe the task in Chat — Larund follows the steps and verifies the result.</div>
      {armed && <div style={{ ...card, borderColor: 'var(--success)', color: 'var(--success)', fontSize: 12.5 }}>"{armed}" is armed for your next chat task.</div>}
      {userWorkflows.map((t) => (
        <div key={t.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{t.name}</strong>
            <button style={btn} onClick={() => arm(t)}>Run in chat</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t.description}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>{t.steps.length} steps · {t.verification.length} checks{t.requiredConnections.length ? ` · needs: ${t.requiredConnections.join(', ')}` : ''}</div>
        </div>
      ))}
      {!wf.loading && userWorkflows.length === 0 && <Empty text="No workflows yet. Larund can suggest one after you repeat a task, or you can build one." icon="play" />}
    </>
  );
}

type Tab = 'skills' | 'personas' | 'workflows';

export function SkillsPage({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('skills');
  return (
    <PageFrame>
      <PageHeader title="Skills" subtitle="Teach Larund reusable ways to work." />
      <Tabs<Tab> tabs={[{ id: 'skills', label: 'Skills' }, { id: 'personas', label: 'Personas' }, { id: 'workflows', label: 'Workflows' }]} value={tab} onChange={setTab} />
      {tab === 'skills' && <SkillsTab userId={userId} />}
      {tab === 'personas' && <PersonasTab />}
      {tab === 'workflows' && <WorkflowsTab userId={userId} />}
    </PageFrame>
  );
}
