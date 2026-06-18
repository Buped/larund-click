// Logins — a vault of site sign-in credentials so Larund can log in by itself
// through its browser. Passwords are stored encrypted on this device and filled
// straight into the page at login time; they are never shown to the AI model.

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import {
  listCredentials, createCredential, updateCredential, deleteCredential,
  normalizeDomain, type LoginCredential,
} from '../../lib/credentials/store';
import { performControlAction } from '../../lib/control-system/executor';
import { AutoApprovalService } from '../../lib/tools/approvals';
import { MemoryAuditLogger } from '../../lib/tools/audit';
import {
  PageFrame, PageHeader, Empty, SearchInput, card, btn, ghostBtn, dangerBtn, input, labelStyle,
} from './ui';

interface DraftState {
  id?: string;
  label: string;
  loginUrl: string;
  username: string;
  password: string;
  notes: string;
}

const EMPTY_DRAFT: DraftState = { label: '', loginUrl: '', username: '', password: '', notes: '' };

function EditModal({ draft, onClose, onSaved }: { draft: DraftState; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<DraftState>(draft);
  const [status, setStatus] = useState('');
  const editing = Boolean(draft.id);

  async function save() {
    if (!d.loginUrl.trim() || !d.username.trim()) { setStatus('Login URL and username are required.'); return; }
    if (!editing && !d.password) { setStatus('Enter the password to save this login.'); return; }
    if (editing && d.id) {
      await updateCredential(d.id, { label: d.label, loginUrl: d.loginUrl, username: d.username, notes: d.notes, ...(d.password ? { password: d.password } : {}) });
    } else {
      await createCredential({ label: d.label, loginUrl: d.loginUrl, username: d.username, password: d.password, notes: d.notes });
    }
    onSaved();
  }

  const set = (k: keyof DraftState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((c) => ({ ...c, [k]: e.target.value }));

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 480, maxHeight: '86vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{editing ? 'Edit login' : 'Add login'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 14 }}>Stored encrypted on this device. The password is filled into the page at login time and never shown to the AI.</div>

        <label style={labelStyle}>Login URL</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.loginUrl} onChange={set('loginUrl')} placeholder="https://example.com/login" />

        <label style={labelStyle}>Label</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.label} onChange={set('label')} placeholder={normalizeDomain(d.loginUrl) || 'e.g. Example (work)'} />

        <label style={labelStyle}>Username / email</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.username} onChange={set('username')} placeholder="you@example.com" />

        <label style={labelStyle}>Password</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} type="password" value={d.password} onChange={set('password')} placeholder={editing ? 'Leave blank to keep current' : 'Password'} />

        <label style={labelStyle}>Notes (optional)</label>
        <textarea style={{ ...input, marginTop: 4, marginBottom: 10, minHeight: 56, resize: 'vertical' }} value={d.notes} onChange={set('notes')} placeholder="2FA hints, account type, etc." />

        {status && <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn} onClick={save}>{editing ? 'Save' : 'Add login'}</button>
        </div>
      </div>
    </div>
  );
}

export function LoginsPage() {
  const [items, setItems] = useState<LoginCredential[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [testing, setTesting] = useState<string>('');
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  function refresh() { setItems(listCredentials()); }
  useEffect(() => { refresh(); }, []);

  async function runTest(c: LoginCredential) {
    setTesting(c.id); setTestMsg((m) => ({ ...m, [c.id]: '' }));
    try {
      const ctx = {
        userId: 'local', sessionId: `logins-${Date.now()}`, workspaceRoot: '~', task: 'test login',
        audit: new MemoryAuditLogger(() => {}), approvals: new AutoApprovalService(),
      };
      const res = await performControlAction({ action: 'browser.login', domain: c.domain, url: c.loginUrl }, ctx);
      setTestMsg((m) => ({ ...m, [c.id]: res.success ? `✓ ${res.output}` : `✗ ${res.error}` }));
      refresh();
    } catch (e) {
      setTestMsg((m) => ({ ...m, [c.id]: `✗ ${String(e instanceof Error ? e.message : e)}` }));
    } finally { setTesting(''); }
  }

  async function remove(c: LoginCredential) {
    await deleteCredential(c.id);
    refresh();
  }

  const filtered = items.filter((c) => !query || `${c.label} ${c.domain} ${c.username}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <PageFrame>
      <PageHeader
        title="Logins"
        subtitle="Save site credentials so Larund can sign in for you. Stored encrypted on this device; the password is never shown to the AI."
        actions={<button style={btn} onClick={() => setDraft(EMPTY_DRAFT)}><Icon name="plus" size={13} stroke={2} /> Add login</button>}
      />
      <SearchInput value={query} onChange={setQuery} placeholder="Search logins…" />

      {filtered.length === 0 ? (
        <Empty text={items.length === 0 ? 'No saved logins yet. Add one so Larund can sign in for you.' : 'No logins match your search.'} icon="lock" />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map((c) => (
            <div key={c.id} style={{ ...card, marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <BrandIcon providerId={c.domain.split('.')[0]} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{c.domain} · {c.username}{c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : ''}</div>
                </div>
                <button style={ghostBtn} disabled={!!testing} onClick={() => runTest(c)}>{testing === c.id ? 'Testing…' : 'Test login'}</button>
                <button style={ghostBtn} onClick={() => setDraft({ id: c.id, label: c.label, loginUrl: c.loginUrl, username: c.username, password: '', notes: c.notes ?? '' })}>Edit</button>
                <button style={dangerBtn} onClick={() => remove(c)}>Delete</button>
              </div>
              {testMsg[c.id] && <div style={{ fontSize: 11.5, color: testMsg[c.id].startsWith('✓') ? 'var(--success)' : 'var(--warning)', marginTop: 8 }}>{testMsg[c.id]}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 16, lineHeight: 1.5 }}>
        Larund signs in with the browser using the saved username and password. In Semi or Manual autonomy it asks before logging in; in Full it signs in silently. Passwords are stored in the app's local secret store on this device (not the OS keychain).
      </div>

      {draft && <EditModal draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); refresh(); }} />}
    </PageFrame>
  );
}
