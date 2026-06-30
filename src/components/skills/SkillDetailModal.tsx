import { useState } from 'react';
import { Icon } from '../icons';
import { Badge, btn, card, dangerBtn, ghostBtn, input, labelStyle, statusColor } from '../pages/ui';
import { SkillMarkdownEditor } from './SkillMarkdownEditor';
import type { SkillPackage } from '../../lib/skills/packages/types';
import { updateSkillPackage, createSkillPackage, deleteSkillPackage, setSkillPackageEnabled } from '../../lib/skills/packages/store';

function lines(value: string): string[] {
  return value.split('\n').map((x) => x.trim()).filter(Boolean);
}

export function SkillDetailModal({ skill, userId, workspaceId, onClose, onChanged }: {
  skill: SkillPackage;
  userId: string;
  workspaceId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const editable = skill.source !== 'built_in';
  const [draft, setDraft] = useState(skill);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!editable) return;
    setSaving(true);
    try {
      await updateSkillPackage(skill.id, {
        name: draft.name,
        description: draft.description,
        categories: draft.categories,
        triggerPhrases: draft.triggerPhrases,
        whenToUse: draft.whenToUse,
        whenNotToUse: draft.whenNotToUse,
        requiredConnections: draft.requiredConnections,
        requiredMcpServers: draft.requiredMcpServers,
        allowedTools: draft.allowedTools,
        riskLevel: draft.riskLevel,
        kind: draft.kind,
        target: draft.target,
        learning: draft.learning,
        instructionBody: draft.instructionBody,
        steps: draft.steps.map((s) => ({ id: s.id, title: s.title, instruction: s.instruction, preferredTools: s.preferredTools, required: s.required })),
        verificationChecklist: draft.verificationChecklist.map((v) => ({
          id: v.id,
          title: v.title,
          description: v.description ?? v.title,
          kind: v.kind === 'contains_text' ? 'assert_text' : v.kind === 'connection_read_back' ? 'connection_read' : v.kind === 'file_read_back' || v.kind === 'doc_read_back' || v.kind === 'sheet_values_match' ? 'read_back' : v.kind,
          required: v.required,
          config: v.config,
        })),
        examplePrompts: draft.examples.map((e) => e.userPrompt),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    setSaving(true);
    try {
      await createSkillPackage({
        userId,
        workspaceId,
        name: `${skill.name} copy`,
        description: skill.description,
        instructionBody: skill.instructionBody,
        triggerPhrases: skill.triggerPhrases,
        categories: skill.categories,
        whenToUse: skill.whenToUse,
        whenNotToUse: skill.whenNotToUse,
        requiredConnections: skill.requiredConnections,
        requiredMcpServers: skill.requiredMcpServers,
        allowedTools: skill.allowedTools,
        riskLevel: skill.riskLevel,
        kind: skill.kind,
        target: skill.target,
        learning: skill.learning,
        steps: skill.steps.map((s) => ({ id: s.id, title: s.title, instruction: s.instruction, preferredTools: s.preferredTools, required: s.required })),
        verificationChecklist: skill.verificationChecklist.map((v) => ({ id: v.id, title: v.title, description: v.description ?? v.title, kind: 'read_back', required: v.required })),
        examplePrompts: skill.examples.map((e) => e.userPrompt),
      });
      onChanged();
    } finally { setSaving(false); }
  }

  async function toggle(enabled: boolean) {
    await setSkillPackageEnabled(skill, enabled, { userId, workspaceId });
    onChanged();
  }

  function dryRun() {
    localStorage.setItem('pending_skill_dry_run', JSON.stringify({
      skillId: skill.id,
      name: skill.name,
      allowedTools: skill.allowedTools,
      requiredConnections: skill.requiredConnections,
      verificationChecklist: skill.verificationChecklist.map((v) => v.title),
      createdAt: new Date().toISOString(),
    }));
  }

  async function mention() {
    const text = `@${skill.name}`;
    localStorage.setItem('pending_chat_skill_mention', text);
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center' }}>
      <div className="modal-pop" style={{ width: 900, maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 18, borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editable ? <input style={{ ...input, fontSize: 18, fontWeight: 700 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /> : <h2 style={{ margin: 0, fontSize: 20 }}>{skill.name}</h2>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <Badge text={skill.source === 'built_in' ? 'Built-in' : skill.source} color={skill.source === 'built_in' ? 'var(--accent)' : 'var(--success)'} />
              <Badge text={`v${skill.version}`} />
              <Badge text={skill.kind === 'app_profile' ? 'App profile' : 'Workflow'} color={skill.kind === 'app_profile' ? 'var(--accent)' : undefined} />
              {skill.learning?.autoLearned && <Badge text="Auto-learned" color="var(--success)" />}
              <Badge text={skill.riskLevel} color={statusColor(skill.riskLevel)} />
              <Badge text={skill.enabled ? 'Enabled' : 'Disabled'} color={statusColor(skill.enabled ? 'enabled' : 'disabled')} />
            </div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: 8 }}><Icon name="x" size={14} stroke={2} /></button>
        </div>

        <div className="scroll" style={{ padding: 18, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section style={card}>
                <div style={labelStyle}>Description</div>
                {editable
                  ? <textarea style={{ ...input, minHeight: 70, marginTop: 6 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  : <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 6 }}>{skill.description}</p>}
              </section>
              <section style={card}>
                <SkillMarkdownEditor readOnly={!editable} value={draft.instructionBody} onChange={(value) => setDraft({ ...draft, instructionBody: value })} />
              </section>
              <InfoList title="Steps/checklist" items={draft.steps.map((s) => `${s.title}: ${s.instruction}`)} />
              <InfoList title="Verification checklist" items={draft.verificationChecklist.map((v) => `${v.title} (${v.kind})`)} />
              <InfoList title="Examples" items={draft.examples.map((e) => `${e.userPrompt} -> ${e.expectedBehavior}`)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <EditableList title="Categories" editable={editable} value={draft.categories.join('\n')} onChange={(v) => setDraft({ ...draft, categories: lines(v) })} />
              <EditableList title="Trigger phrases" editable={editable} value={draft.triggerPhrases.join('\n')} onChange={(v) => setDraft({ ...draft, triggerPhrases: lines(v) })} />
              <EditableList title="When to use" editable={editable} value={draft.whenToUse.join('\n')} onChange={(v) => setDraft({ ...draft, whenToUse: lines(v) })} />
              <EditableList title="When not to use" editable={editable} value={draft.whenNotToUse.join('\n')} onChange={(v) => setDraft({ ...draft, whenNotToUse: lines(v) })} />
              <EditableList title="Required connections" editable={editable} value={draft.requiredConnections.join('\n')} onChange={(v) => setDraft({ ...draft, requiredConnections: lines(v) })} />
              <EditableList title="Required MCP servers" editable={editable} value={draft.requiredMcpServers.join('\n')} onChange={(v) => setDraft({ ...draft, requiredMcpServers: lines(v) })} />
              <EditableList title="Allowed tools" editable={editable} value={draft.allowedTools.join('\n')} onChange={(v) => setDraft({ ...draft, allowedTools: lines(v) })} />
              {draft.kind === 'app_profile' && <InfoList title="App/site target" items={[
                draft.target?.appName ? `App: ${draft.target.appName}` : '',
                draft.target?.domain ? `Domain: ${draft.target.domain}` : '',
                ...(draft.target?.urlPatterns ?? []).map((p) => `URL: ${p}`),
                ...(draft.target?.windowTitlePatterns ?? []).map((p) => `Window: ${p}`),
              ].filter(Boolean)} />}
              {draft.learning && <InfoList title="Learning" items={[
                `Source tasks: ${draft.learning.originTaskRunIds.length}`,
                `Confidence: ${Math.round(draft.learning.confidence * 100)}%`,
                `Usage: ${draft.learning.usageCount} (${draft.learning.successCount} success / ${draft.learning.failureCount} failed)`,
                draft.learning.promotedAt ? `Promoted: ${draft.learning.promotedAt}` : '',
              ].filter(Boolean)} />}
              <InfoList title="Related automations" items={['No related automations recorded yet.']} />
              <InfoList title="Last used" items={[skill.lastUsedAt ?? 'Not used yet']} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--border)' }}>
          <button style={ghostBtn} onClick={() => void toggle(!skill.enabled)}>{skill.enabled ? 'Disable' : 'Enable'}</button>
          <button style={ghostBtn} onClick={duplicate} disabled={saving}>Duplicate as custom skill</button>
          <button style={ghostBtn} onClick={dryRun}>Test skill</button>
          <button style={ghostBtn} onClick={() => localStorage.setItem('pending_chat_skill_id', skill.id)}>Use in chat</button>
          <button style={ghostBtn} onClick={mention}>Mention as @skill</button>
          <button style={ghostBtn} onClick={() => localStorage.setItem('pending_automation_skill_id', skill.id)}>Use in automation</button>
          <div style={{ flex: 1 }} />
          {editable && <button style={dangerBtn} onClick={() => deleteSkillPackage(skill.id).then(onChanged)}>Delete</button>}
          {editable && <button style={btn} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>}
        </div>
      </div>
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <section style={card}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{title}</div>
      {items.length ? items.map((item, i) => <div key={i} style={{ fontSize: 12.3, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 5 }}>{item}</div>) : <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>None</div>}
    </section>
  );
}

function EditableList({ title, value, onChange, editable }: { title: string; value: string; onChange: (v: string) => void; editable: boolean }) {
  return (
    <section style={card}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{title}</div>
      {editable
        ? <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={value} onChange={(e) => onChange(e.target.value)} />
        : value.split('\n').filter(Boolean).map((item) => <Badge key={item} text={item} />)}
    </section>
  );
}
