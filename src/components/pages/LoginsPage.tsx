// Apps & Logins — user-defined apps/sites Larund can operate when @-mentioned in
// chat. Each app bundles its URLs, a saved login (password kept in the secure
// vault, never shown to the model), a preferred browser, and usage hints. Also
// hosts the browser-profile manager (which Chromium-based browser to drive).

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import {
  listApps, createApp, updateApp, deleteApp, appStatus, type AppProfile,
} from '../../lib/apps/store';
import {
  listBrowserProfiles, createBrowserProfile, deleteBrowserProfile, validateBrowserProfile,
  DEFAULT_BROWSER_PROFILE, type BrowserProfile, type BrowserKind,
} from '../../lib/browser/profiles';
import { performControlAction } from '../../lib/control-system/executor';
import { AutoApprovalService } from '../../lib/tools/approvals';
import { MemoryAuditLogger } from '../../lib/tools/audit';
import {
  PageFrame, PageHeader, Empty, SearchInput, card, btn, ghostBtn, dangerBtn, input, labelStyle, Badge,
} from './ui';

const STATUS_LABEL: Record<ReturnType<typeof appStatus>, { text: string; color: string }> = {
  ready: { text: 'Ready', color: 'var(--success)' },
  needs_password: { text: 'Needs password', color: 'var(--warning)' },
  needs_setup: { text: 'Needs setup', color: 'var(--text-hint)' },
};

// ── App add/edit modal ─────────────────────────────────────────────────────────

interface AppDraft {
  id?: string;
  label: string;
  homeUrl: string;
  loginUrl: string;
  username: string;
  password: string;
  preferredBrowserId: string;
  notes: string;
  usageHints: string;
}

const EMPTY_APP: AppDraft = { label: '', homeUrl: '', loginUrl: '', username: '', password: '', preferredBrowserId: DEFAULT_BROWSER_PROFILE.id, notes: '', usageHints: '' };

function AppModal({ draft, browsers, onClose, onSaved }: { draft: AppDraft; browsers: BrowserProfile[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<AppDraft>(draft);
  const [status, setStatus] = useState('');
  const editing = Boolean(draft.id);
  const set = (k: keyof AppDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD((c) => ({ ...c, [k]: e.target.value }));

  async function save() {
    if (!d.label.trim()) { setStatus('Give the app a name.'); return; }
    if (!d.homeUrl.trim() && !d.loginUrl.trim()) { setStatus('Add the app website or login URL.'); return; }
    const payload = {
      label: d.label, homeUrl: d.homeUrl, loginUrl: d.loginUrl, username: d.username,
      preferredBrowserId: d.preferredBrowserId, notes: d.notes, usageHints: d.usageHints,
      ...(d.password ? { password: d.password } : {}),
    };
    if (editing && d.id) await updateApp(d.id, payload);
    else await createApp(payload);
    onSaved();
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 500, maxHeight: '88vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{editing ? 'Edit app' : 'Add app'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 14, lineHeight: 1.5 }}>
          Larund can use this app when you mention it in chat. Passwords are stored encrypted on this device and never sent to the model.
        </div>

        <label style={labelStyle}>App name</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.label} onChange={set('label')} placeholder="e.g. Shopify Client Store" />

        <label style={labelStyle}>Website / app URL</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.homeUrl} onChange={set('homeUrl')} placeholder="https://admin.shopify.com" />

        <label style={labelStyle}>Login URL (optional)</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.loginUrl} onChange={set('loginUrl')} placeholder="https://…/login" />

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Username / email</label>
            <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.username} onChange={set('username')} placeholder="you@example.com" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Password</label>
            <input style={{ ...input, marginTop: 4, marginBottom: 10 }} type="password" value={d.password} onChange={set('password')} placeholder={editing ? 'Leave blank to keep' : 'Password'} />
          </div>
        </div>

        <label style={labelStyle}>Preferred browser</label>
        <select style={{ ...input, marginTop: 4, marginBottom: 10 }} value={d.preferredBrowserId} onChange={set('preferredBrowserId')}>
          {browsers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>

        <label style={labelStyle}>Notes (account type, 2FA info)</label>
        <textarea style={{ ...input, marginTop: 4, marginBottom: 10, minHeight: 48, resize: 'vertical' }} value={d.notes} onChange={set('notes')} placeholder="e.g. admin account, 2FA via authenticator app" />

        <label style={labelStyle}>Usage hints (what Larund should use it for)</label>
        <textarea style={{ ...input, marginTop: 4, marginBottom: 10, minHeight: 48, resize: 'vertical' }} value={d.usageHints} onChange={set('usageHints')} placeholder="e.g. Product edits and order lookup." />

        {status && <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn} onClick={save}>{editing ? 'Save' : 'Add app'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Browser profile manager ─────────────────────────────────────────────────────

const BROWSER_KINDS: Array<{ kind: BrowserKind; label: string; hint: string }> = [
  { kind: 'agent_chrome', label: 'Agent Chrome (managed)', hint: 'Larund launches a dedicated Chrome with remote debugging. Recommended.' },
  { kind: 'agent_edge', label: 'Agent Edge (managed)', hint: 'Larund launches Microsoft Edge with remote debugging.' },
  { kind: 'custom_chromium', label: 'Custom Chromium', hint: 'Point to a Chromium-based browser executable.' },
  { kind: 'existing_cdp', label: 'Existing CDP endpoint', hint: 'Connect to a browser already started with --remote-debugging-port.' },
];

function BrowserProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<BrowserKind>('agent_edge');
  const [label, setLabel] = useState('');
  const [executablePath, setExe] = useState('');
  const [cdpEndpoint, setCdp] = useState('');
  const [port, setPort] = useState('');
  const [profileDir, setDir] = useState('');
  const [status, setStatus] = useState('');
  const meta = BROWSER_KINDS.find((k) => k.kind === kind)!;

  function save() {
    const draft: Omit<BrowserProfile, 'id'> = {
      label: label.trim() || meta.label,
      kind,
      executablePath: executablePath.trim() || undefined,
      cdpEndpoint: cdpEndpoint.trim() || undefined,
      remoteDebuggingPort: port.trim() ? Number(port.trim()) : undefined,
      profileDir: profileDir.trim() || undefined,
    };
    const v = validateBrowserProfile(draft);
    if (!v.ok) { setStatus(v.error ?? 'Invalid configuration.'); return; }
    try { createBrowserProfile(draft); onSaved(); }
    catch (e) { setStatus(String(e instanceof Error ? e.message : e)); }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 90, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 460, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Add browser profile</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 14, lineHeight: 1.5 }}>
          Larund can only automate Chromium-based browsers (Chrome / Edge / Chromium) through CDP.
        </div>

        <label style={labelStyle}>Type</label>
        <select style={{ ...input, marginTop: 4, marginBottom: 6 }} value={kind} onChange={(e) => setKind(e.target.value as BrowserKind)}>
          {BROWSER_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginBottom: 10 }}>{meta.hint}</div>

        <label style={labelStyle}>Label</label>
        <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={meta.label} />

        {kind === 'custom_chromium' && (
          <>
            <label style={labelStyle}>Executable path</label>
            <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={executablePath} onChange={(e) => setExe(e.target.value)} placeholder="C:\\Path\\To\\chrome.exe" />
          </>
        )}
        {kind === 'existing_cdp' && (
          <>
            <label style={labelStyle}>CDP endpoint</label>
            <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={cdpEndpoint} onChange={(e) => setCdp(e.target.value)} placeholder="http://localhost:9223" />
          </>
        )}
        {(kind === 'agent_chrome' || kind === 'agent_edge' || kind === 'custom_chromium') && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Debug port (optional)</label>
              <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Profile dir (optional)</label>
              <input style={{ ...input, marginTop: 4, marginBottom: 10 }} value={profileDir} onChange={(e) => setDir(e.target.value)} placeholder="auto" />
            </div>
          </div>
        )}

        {status && <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={onClose}>Cancel</button>
          <button style={btn} onClick={save}>Add profile</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function LoginsPage() {
  const [apps, setApps] = useState<AppProfile[]>([]);
  const [browsers, setBrowsers] = useState<BrowserProfile[]>([]);
  const [query, setQuery] = useState('');
  const [appDraft, setAppDraft] = useState<AppDraft | null>(null);
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [showBrowsers, setShowBrowsers] = useState(false);
  const [testing, setTesting] = useState('');
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  function refresh() { setApps(listApps()); setBrowsers(listBrowserProfiles()); }
  useEffect(() => { refresh(); }, []);

  async function runTest(app: AppProfile) {
    setTesting(app.id); setTestMsg((m) => ({ ...m, [app.id]: '' }));
    try {
      const ctx = {
        userId: 'local', sessionId: `apps-${Date.now()}`, workspaceRoot: '~', task: 'test login',
        audit: new MemoryAuditLogger(() => {}), approvals: new AutoApprovalService(),
      };
      const res = await performControlAction({ action: 'browser.login', app_id: app.id }, ctx);
      setTestMsg((m) => ({ ...m, [app.id]: res.success ? `✓ ${res.output}` : `✗ ${res.error}` }));
      refresh();
    } catch (e) {
      setTestMsg((m) => ({ ...m, [app.id]: `✗ ${String(e instanceof Error ? e.message : e)}` }));
    } finally { setTesting(''); }
  }

  const filtered = apps.filter((a) => !query || `${a.label} ${a.domain} ${a.username ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const browserName = (id?: string) => browsers.find((b) => b.id === id)?.label ?? DEFAULT_BROWSER_PROFILE.label;

  return (
    <PageFrame>
      <PageHeader
        title="Apps & Logins"
        subtitle="Save the apps you use so Larund can open and sign in to them when you @mention them in chat. Passwords are stored encrypted on this device and never sent to the AI."
        actions={<button style={btn} onClick={() => setAppDraft(EMPTY_APP)}><Icon name="plus" size={13} stroke={2} /> Add app</button>}
      />
      <SearchInput value={query} onChange={setQuery} placeholder="Search apps…" />

      {filtered.length === 0 ? (
        <Empty text={apps.length === 0 ? 'No apps yet. Add one so you can @mention it in chat.' : 'No apps match your search.'} icon="lock" />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map((app) => {
            const st = STATUS_LABEL[appStatus(app)];
            return (
              <div key={app.id} style={{ ...card, marginBottom: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <BrandIcon providerId={(app.domain || app.label).split('.')[0]} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{app.label}</span>
                      <Badge text={st.text} color={st.color} />
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>
                      {app.domain || 'no domain'}{app.username ? ` · ${app.username}` : ''} · {browserName(app.preferredBrowserId)}
                    </div>
                  </div>
                  <button style={ghostBtn} disabled={!!testing} onClick={() => runTest(app)}>{testing === app.id ? 'Testing…' : 'Test login'}</button>
                  <button style={ghostBtn} onClick={() => setAppDraft({ id: app.id, label: app.label, homeUrl: app.homeUrl ?? '', loginUrl: app.loginUrl ?? '', username: app.username ?? '', password: '', preferredBrowserId: app.preferredBrowserId ?? DEFAULT_BROWSER_PROFILE.id, notes: app.notes ?? '', usageHints: app.usageHints ?? '' })}>Edit</button>
                  <button style={dangerBtn} onClick={async () => { await deleteApp(app.id); refresh(); }}>Delete</button>
                </div>
                {testMsg[app.id] && <div style={{ fontSize: 11.5, color: testMsg[app.id].startsWith('✓') ? 'var(--success)' : 'var(--warning)', marginTop: 8 }}>{testMsg[app.id]}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Browser profiles */}
      <div style={{ marginTop: 22 }}>
        <button style={{ ...ghostBtn }} onClick={() => setShowBrowsers((v) => !v)}>
          <Icon name="chevronDown" size={12} stroke={1.8} style={{ transform: showBrowsers ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} /> Browser profiles ({browsers.length})
        </button>
        {showBrowsers && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginBottom: 10, lineHeight: 1.5 }}>
              Which browser Larund drives. Only Chromium-based browsers can be automated (via CDP). A normal running browser can't be controlled unless it was started with a remote-debugging port.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {browsers.map((b) => (
                <div key={b.id} style={{ ...card, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="monitor" size={15} stroke={1.7} style={{ color: 'var(--accent)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{b.label} {b.isDefault && <Badge text="Default" color="var(--success)" />}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>{b.kind}{b.cdpEndpoint ? ` · ${b.cdpEndpoint}` : ''}{b.executablePath ? ` · ${b.executablePath}` : ''}</div>
                  </div>
                  {!b.isDefault && <button style={dangerBtn} onClick={() => { deleteBrowserProfile(b.id); refresh(); }}>Remove</button>}
                </div>
              ))}
            </div>
            <button style={{ ...ghostBtn, marginTop: 10 }} onClick={() => setShowBrowserModal(true)}><Icon name="plus" size={12} stroke={2} /> Add browser profile</button>
          </div>
        )}
      </div>

      {appDraft && <AppModal draft={appDraft} browsers={browsers} onClose={() => setAppDraft(null)} onSaved={() => { setAppDraft(null); refresh(); }} />}
      {showBrowserModal && <BrowserProfileModal onClose={() => setShowBrowserModal(false)} onSaved={() => { setShowBrowserModal(false); refresh(); }} />}
    </PageFrame>
  );
}
