import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { btn, card, ghostBtn, input, labelStyle } from '../pages/ui';
import { SkillMarkdownEditor } from './SkillMarkdownEditor';
import { createSkillPackage } from '../../lib/skills/packages/store';
import type { ToolRisk } from '../../lib/control-system/types';

const STEPS = ['Basics', 'When to use', 'Instructions', 'Tools', 'Verification', 'Examples', 'Save and test'];
const TEMPLATE = `## Goal

## Inputs

## Process

## Output

## Style / Rules

## Verification

## Failure handling
`;

function splitLines(v: string): string[] {
  return v.split('\n').map((x) => x.trim()).filter(Boolean);
}

export function NewSkillWizard({ userId, workspaceId, onClose, onSaved }: {
  userId: string;
  workspaceId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState('general');
  const [triggers, setTriggers] = useState('');
  const [whenToUse, setWhenToUse] = useState('');
  const [whenNotToUse, setWhenNotToUse] = useState('');
  const [instructionBody, setInstructionBody] = useState(TEMPLATE);
  const [allowedTools, setAllowedTools] = useState('');
  const [requiredConnections, setRequiredConnections] = useState('');
  const [requiredMcpServers, setRequiredMcpServers] = useState('');
  const [riskLevel, setRiskLevel] = useState<ToolRisk>('read_only');
  const [verification, setVerification] = useState('Output was read back');
  const [examples, setExamples] = useState('');
  const [testPrompt, setTestPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim() || !description.trim()) { setError('Name and description are required.'); return; }
    setSaving(true);
    setError('');
    try {
      await createSkillPackage({
        userId,
        workspaceId,
        name,
        description,
        source: workspaceId ? 'workspace' : 'user',
        kind: 'workflow',
        categories: splitLines(categories),
        triggerPhrases: splitLines(triggers),
        whenToUse: splitLines(whenToUse),
        whenNotToUse: splitLines(whenNotToUse),
        instructionBody,
        allowedTools: splitLines(allowedTools),
        requiredConnections: splitLines(requiredConnections),
        requiredMcpServers: splitLines(requiredMcpServers),
        riskLevel,
        verificationChecklist: splitLines(verification).map((title, index) => ({ id: `v-${index}`, title, description: title, kind: 'read_back', required: true })),
        examplePrompts: splitLines(examples),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center' }}>
      <div className="modal-pop" style={{ width: 780, maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => <button key={s} onClick={() => setStep(i)} style={{ ...ghostBtn, ...(i === step ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)' } : {}) }}>{i + 1}. {s}</button>)}
          <div style={{ flex: 1 }} />
          <button style={ghostBtn} onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="scroll" style={{ padding: 18, overflow: 'auto' }}>
          {step === 0 && <Pane title="Basics"><Field label="Skill name" value={name} onChange={setName} /><Field label="Short description" value={description} onChange={setDescription} /><Area label="Categories" value={categories} onChange={setCategories} /></Pane>}
          {step === 1 && <Pane title="When to use"><Area label="Trigger phrases" value={triggers} onChange={setTriggers} /><Area label="When to use" value={whenToUse} onChange={setWhenToUse} /><Area label="When not to use" value={whenNotToUse} onChange={setWhenNotToUse} /></Pane>}
          {step === 2 && <Pane title="Instructions"><SkillMarkdownEditor value={instructionBody} onChange={setInstructionBody} minHeight={360} /></Pane>}
          {step === 3 && <Pane title="Tools and context"><Area label="Allowed tools" value={allowedTools} onChange={setAllowedTools} /><Area label="Required connections" value={requiredConnections} onChange={setRequiredConnections} /><Area label="Required MCP servers" value={requiredMcpServers} onChange={setRequiredMcpServers} /><Field label="Risk level" value={riskLevel} onChange={(v) => setRiskLevel(v as ToolRisk)} /></Pane>}
          {step === 4 && <Pane title="Verification"><Area label="Checklist items" value={verification} onChange={setVerification} /><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{['Output file exists', 'Output was read back', 'Sheet values were read back', 'Google Doc was read back', 'Manual review required', 'Contains required sections'].map((p) => <button key={p} style={ghostBtn} onClick={() => setVerification((v) => `${v}${v.trim() ? '\n' : ''}${p}`)}>{p}</button>)}</div></Pane>}
          {step === 5 && <Pane title="Examples"><Area label="Example user prompts" value={examples} onChange={setExamples} /></Pane>}
          {step === 6 && <Pane title="Save and test"><Field label="Optional test prompt" value={testPrompt} onChange={setTestPrompt} /><div style={{ ...card, fontSize: 12.5, color: 'var(--text-muted)' }}>Dry-run selection preview: this skill will match {splitLines(triggers).length || 0} trigger phrases and will not execute external actions from this wizard.</div></Pane>}
          {error && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--border)' }}>
          {step > 0 && <button style={ghostBtn} onClick={() => setStep((s) => s - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          {step < STEPS.length - 1 ? <button style={btn} onClick={() => setStep((s) => s + 1)}>Next</button> : <button style={btn} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save skill'}</button>}
        </div>
      </div>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><h2 style={{ fontSize: 17 }}>{title}</h2>{children}</div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label style={{ display: 'block' }}><div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div><input style={input} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label style={{ display: 'block' }}><div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div><textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
