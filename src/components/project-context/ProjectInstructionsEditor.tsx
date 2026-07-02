import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

const input: CSSProperties = { width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '9px 11px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 };

export function ProjectInstructionsEditor({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  async function save() {
    if (!dirty || saving || disabled) return;
    setSaving(true); setStatus('');
    try {
      await onSave(draft);
      setStatus('Saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <textarea
        rows={5}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Rules Larund should follow inside this project. These are shared project instructions, not private memory."
        style={input}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} disabled={!dirty || saving || disabled} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save instructions'}
        </button>
        {status && <span style={{ fontSize: 11.5, color: status === 'Saved.' ? 'var(--text-hint)' : 'var(--danger)' }}>{status}</span>}
      </div>
    </div>
  );
}
