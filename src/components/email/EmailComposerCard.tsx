import { useState } from 'react';
import type { EmailDraft, EmailDraftStatus } from '../../lib/email/types';
import { isGmailConnected, saveGmailDraft, sendGmailDraft } from '../../lib/email/gmail-actions';
import { markdownToEmailInnerHtml } from '../../lib/email/html';
import { beginOAuthConnect } from '../../lib/connections/oauth/connect';

// Chat-embedded email composer. Renders an editable mini email client and drives
// the real Gmail draft/send tools. Status is authoritative: a local_draft is never
// presented as a Gmail draft, and "sent" only appears with a provider message id.

const STATUS_LABEL: Record<EmailDraftStatus, string> = {
  local_draft: 'Helyi vázlat (Gmail nincs csatlakoztatva)',
  gmail_draft_created: 'Gmail piszkozat létrehozva',
  needs_review: 'Ellenőrzésre vár',
  approval_required: 'Jóváhagyásra vár',
  sending: 'Küldés folyamatban…',
  sent: 'Elküldve',
  failed: 'Hiba',
};

const STATUS_COLOR: Record<EmailDraftStatus, string> = {
  local_draft: 'var(--text-hint)',
  gmail_draft_created: 'var(--accent)',
  needs_review: 'var(--warning)',
  approval_required: 'var(--warning)',
  sending: 'var(--accent)',
  sent: 'var(--success, #34A853)',
  failed: 'var(--danger)',
};

interface Props {
  draft: EmailDraft;
  userId?: string;
  onChange: (draft: EmailDraft) => void;
}

const field: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '7px 10px',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
};

const label: React.CSSProperties = { fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 };

export function EmailComposerCard({ draft, userId, onChange }: Props) {
  const [busy, setBusy] = useState<null | 'save' | 'send'>(null);
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));
  const [bodyView, setBodyView] = useState<'preview' | 'source'>('preview');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  // draft.gmailConnected flips true after a successful inline connect; otherwise
  // ask the live store. This keeps the card reactive right after connecting.
  const connected = draft.gmailConnected || (userId ? isGmailConnected(userId) : false);
  const editable = draft.status !== 'sending' && draft.status !== 'sent';

  const patch = (p: Partial<EmailDraft>) => onChange({ ...draft, ...p, updatedAt: new Date().toISOString() });

  async function handleSave() {
    if (!userId || busy) return;
    if (!connected) { patch({ status: 'local_draft', gmailConnected: false }); return; }
    setBusy('save');
    patch({ status: 'needs_review' });
    const next = await saveGmailDraft(userId, draft);
    onChange(next);
    setBusy(null);
  }

  async function handleSend() {
    if (!userId || busy) return;
    if (!connected) { patch({ status: 'local_draft' }); return; }
    if (!window.confirm(`Biztosan elküldöd ezt az emailt?\n\nCímzett: ${draft.to}\nTárgy: ${draft.subject}`)) return;
    setBusy('send');
    onChange({ ...draft, status: 'sending' });
    // Save first if there is no Gmail draft yet, so send has a draft to use.
    let working = draft;
    if (!working.gmailDraftId) {
      working = await saveGmailDraft(userId, draft);
      if (working.status === 'failed') { onChange(working); setBusy(null); return; }
    }
    const sent = await sendGmailDraft(userId, working);
    onChange(sent);
    setBusy(null);
  }

  // One-click connect right on the card: OAuth in the system browser, then save
  // the draft as a real Gmail draft so Send works immediately. No chat round-trip.
  async function handleConnect() {
    if (!userId || connecting) return;
    setConnecting(true);
    setConnectError('');
    try {
      await beginOAuthConnect('google-workspace', { userId });
      setBusy('save');
      const saved = await saveGmailDraft(userId, { ...draft, gmailConnected: true });
      onChange(saved);
      setBusy(null);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setConnectError(
        msg.includes('oauth_loopback_unavailable') ? 'A csatlakozás a Larund asztali appot igényli.'
        : msg.includes('oauth_cancelled') ? 'A bejelentkezés megszakadt vagy lejárt.'
        : msg.includes('developer_setup_missing') ? 'A Google OAuth alkalmazás nincs beállítva ezen a gépen (hiányzó Client ID).'
        : msg.includes('oauth_state_mismatch') ? 'Biztonsági ellenőrzés sikertelen (state). Próbáld újra.'
        : `A csatlakozás nem sikerült: ${msg}`,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleCopy() {
    const text = `To: ${draft.to}\n${draft.cc ? `Cc: ${draft.cc}\n` : ''}${draft.bcc ? `Bcc: ${draft.bcc}\n` : ''}Subject: ${draft.subject}\n\n${draft.body}`;
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be unavailable */ }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>✉️ Email</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: STATUS_COLOR[draft.status] }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_COLOR[draft.status] }} />
          {STATUS_LABEL[draft.status]}
        </span>
      </div>

      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        <div>
          <div style={label}>Címzett</div>
          <input style={field} value={draft.to} disabled={!editable} placeholder="valaki@example.com"
            onChange={(e) => patch({ to: e.target.value })} />
        </div>

        {!showCc && editable && (
          <button onClick={() => setShowCc(true)} style={{ justifySelf: 'start', background: 'none', border: 'none', color: 'var(--text-hint)', fontSize: 11.5, cursor: 'pointer', padding: 0 }}>+ Cc / Bcc</button>
        )}
        {showCc && (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <div><div style={label}>Cc</div><input style={field} value={draft.cc ?? ''} disabled={!editable} onChange={(e) => patch({ cc: e.target.value })} /></div>
            <div><div style={label}>Bcc</div><input style={field} value={draft.bcc ?? ''} disabled={!editable} onChange={(e) => patch({ bcc: e.target.value })} /></div>
          </div>
        )}

        <div>
          <div style={label}>Tárgy</div>
          <input style={field} value={draft.subject} disabled={!editable} onChange={(e) => patch({ subject: e.target.value })} />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
            <div style={label}>Szöveg</div>
            <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: 2 }}>
              <button onClick={() => setBodyView('preview')} style={toggleBtn(bodyView === 'preview')}>Előnézet</button>
              <button onClick={() => setBodyView('source')} style={toggleBtn(bodyView === 'source')}>Forrás</button>
            </div>
          </div>
          {bodyView === 'preview' ? (
            <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', minHeight: 150, maxHeight: 360, overflow: 'auto' }}>
              <div dangerouslySetInnerHTML={{ __html: markdownToEmailInnerHtml(draft.body) }} />
            </div>
          ) : (
            <textarea
              style={{ ...field, minHeight: 150, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
              value={draft.body}
              disabled={!editable}
              placeholder="Markdown: **félkövér**, ## címsor, - felsorolás…"
              onChange={(e) => patch({ body: e.target.value })}
            />
          )}
        </div>

        {(draft.sources?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>Forrás:</span>
            {draft.sources!.map((s, i) => (
              <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {s.kind?.includes('sheet') ? '📊' : s.kind?.includes('slide') ? '📑' : '📄'} {s.label}
              </span>
            ))}
          </div>
        )}

        {draft.error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 8, padding: '7px 10px' }}>
            {draft.error}
          </div>
        )}

        {!connected && (
          <div style={{ fontSize: 12, color: 'var(--text-hint)', background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 8, padding: '8px 10px' }}>
            A Gmail még nincs csatlakoztatva. Csatlakoztasd egy kattintással lent — utána a piszkozat azonnal létrejön a Gmail-fiókodban, és küldhető.
          </div>
        )}

        {connectError && (
          <div style={{ fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', borderRadius: 8, padding: '7px 10px' }}>
            {connectError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
          {!connected ? (
            <button onClick={handleConnect} disabled={!userId || connecting || !!busy} style={btn(Boolean(userId) && !connecting && !busy, true)}>
              {connecting ? 'Csatlakozás…' : busy === 'save' ? 'Piszkozat mentése…' : 'Gmail csatlakoztatása'}
            </button>
          ) : (
            <>
              <button onClick={handleSave} disabled={!editable || !!busy}
                style={btn(editable && !busy, false)}>
                {busy === 'save' ? 'Mentés…' : draft.status === 'gmail_draft_created' ? 'Piszkozat frissítése' : 'Gmail piszkozat mentése'}
              </button>
              <button onClick={handleSend} disabled={!editable || !!busy}
                style={btn(editable && !busy, true)}>
                {busy === 'send' ? 'Küldés…' : 'Küldés'}
              </button>
            </>
          )}
          <button onClick={handleCopy} style={btn(true, false)}>Másolás</button>
          {draft.webUrl && (
            <a href={draft.webUrl} target="_blank" rel="noreferrer" style={{ ...btn(true, false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Megnyitás Gmailben
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 5,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-hint)',
    fontWeight: active ? 600 : 400,
  };
}

function btn(enabled: boolean, primary: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    padding: '7px 14px',
    borderRadius: 8,
    cursor: enabled ? 'pointer' : 'not-allowed',
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg)',
    color: primary ? 'var(--on-accent, #0B0E14)' : 'var(--text)',
    opacity: enabled ? 1 : 0.5,
  };
}
