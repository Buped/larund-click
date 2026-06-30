import { useMemo, useState } from 'react';
import {
  listTemplates, saveTemplate, deleteTemplate, fillTemplate,
  type EmailTemplate,
} from '../../lib/email/templates';

// Compact, reusable email-template control: a dropdown to apply a saved/built-in
// template into the current subject/body, plus a "save as template" action for the
// current draft. Pure UI over the localStorage-backed template store.

interface Props {
  userId?: string;
  subject: string;
  body: string;
  disabled?: boolean;
  onApply: (next: { subject: string; body: string }) => void;
}

const ctl: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7,
  padding: '5px 9px', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
};

export function TemplatePicker({ userId, subject, body, disabled, onApply }: Props) {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const templates = useMemo(() => (userId ? listTemplates(userId) : listTemplates('')), [userId, version]);

  function apply(tpl: EmailTemplate) {
    // Fill with no values: built-in placeholders stay as {{…}} for the user to edit.
    onApply(fillTemplate(tpl));
    setOpen(false);
  }

  function saveCurrent() {
    if (!userId) return;
    const name = saveName.trim() || (subject.trim() || 'Sablon').slice(0, 60);
    saveTemplate(userId, { name, subject, body });
    setSaveName('');
    setVersion((v) => v + 1);
    setOpen(false);
  }

  function remove(tpl: EmailTemplate) {
    if (!userId || tpl.builtin) return;
    deleteTemplate(userId, tpl.id);
    setVersion((v) => v + 1);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" style={{ ...ctl, opacity: disabled ? 0.5 : 1 }} disabled={disabled}
        onClick={() => setOpen((v) => !v)}>
        📋 Sablon
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 40, width: 280,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 14px 34px rgba(0,0,0,.35)', padding: 8,
        }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: 0.4, padding: '2px 4px 6px' }}>
            Sablon betöltése
          </div>
          <div style={{ maxHeight: 200, overflow: 'auto', display: 'grid', gap: 2 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" onClick={() => apply(t)} style={{
                  flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text)', fontSize: 12.5, padding: '6px 6px', borderRadius: 6, fontFamily: 'inherit',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                  {t.builtin ? '⭐ ' : ''}{t.name}
                </button>
                {!t.builtin && (
                  <button type="button" onClick={() => remove(t)} title="Törlés" style={{
                    background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 13, padding: '2px 4px',
                  }}>✕</button>
                )}
              </div>
            ))}
            {templates.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-hint)', padding: '8px 4px' }}>Még nincs sablon.</div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8, display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Aktuális mentése sablonként
            </div>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Sablon neve"
              style={{ ...ctl, width: '100%', cursor: 'text', boxSizing: 'border-box' }} />
            <button type="button" onClick={saveCurrent} disabled={!userId}
              style={{ ...ctl, justifySelf: 'start', background: 'var(--accent)', color: 'var(--on-accent, #0B0E14)', border: 'none', opacity: userId ? 1 : 0.5 }}>
              Mentés sablonként
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
