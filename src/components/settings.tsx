import React, { useState, useEffect } from 'react';
import { Icon, ClickMark } from './icons';
import {
  getSettings, updateSettings,
  getApps, saveApp as dbSaveApp, deleteApp as dbDeleteApp,
  getMemoryEntries, addMemoryEntry, updateMemoryEntry, deleteMemoryEntry,
} from '../lib/database';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from '../lib/auth';
import type { UserCredits } from '../lib/supabase';

function emailInitials(email: string): string {
  const local = email.split('@')[0];
  const parts = local.split(/[._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

type AppEntry = {
  id: string;
  name: string;
  app_type: 'web' | 'desktop';
  url: string;
  description: string;
  usage_notes: string;
  credential_email: string;
  credential_password: string;
};

type MemEntry = {
  id: string;
  content: string;
  source: string;
  created_at: string;
};

const SECTIONS = [
  { id: "general",    icon: "settings",  label: "General"    },
  { id: "appearance", icon: "eye",       label: "Appearance" },
  { id: "automation", icon: "zap",       label: "Automation" },
  { id: "behavior",   icon: "sparkle",   label: "Behavior"   },
  { id: "memory",     icon: "cpu",       label: "Memory"     },
  { id: "apps",       icon: "globe",     label: "Apps"       },
  { id: "account",    icon: "user",      label: "Account"    },
  { id: "danger",     icon: "alert",     label: "Danger zone"},
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ width: 38, height: 22, borderRadius: 11, background: checked ? "var(--accent)" : "rgba(255,255,255,.12)", border: "none", cursor: "pointer", position: "relative", transition: "background .2s", flex: "none" }}>
      <span style={{ position: "absolute", top: 3, left: checked ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", display: "block" }} />
    </button>
  );
}

function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
      <div>
        <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 450 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--text-hint)", marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 8, padding: "5px 28px 5px 10px", fontSize: 13, color: "var(--text-primary)", outline: "none", cursor: "pointer", appearance: "none", fontFamily: "inherit" }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function AppFormModal({ app, onSave, onClose }: { app: AppEntry | null; onSave: (a: AppEntry) => void; onClose: () => void }) {
  const isNew = app === null;
  const [name,     setName    ] = useState(app?.name || "");
  const [appType,  setAppType ] = useState<"web"|"desktop">(app?.app_type || "web");
  const [url,      setUrl     ] = useState(app?.url || "");
  const [desc,     setDesc    ] = useState(app?.description || "");
  const [email,    setEmail   ] = useState(app?.credential_email || "");
  const [password, setPassword] = useState(app?.credential_password || "");
  const [showPwd,  setShowPwd ] = useState(false);

  function save() {
    if (!name.trim()) return;
    onSave({
      id: app?.id || uuidv4(),
      name: name.trim(),
      app_type: appType,
      url,
      description: desc,
      usage_notes: app?.usage_notes || '',
      credential_email: email,
      credential_password: password,
    });
  }

  const inp = (v: string, onChange: (s: string) => void, placeholder?: string, extra?: React.CSSProperties): React.ReactNode => (
    <input value={v} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 9, padding: "9px 12px", fontSize: 13, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", boxSizing: "border-box", display: "block", ...extra }}
      onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
      onBlur={e => (e.currentTarget.style.borderColor = "var(--border-md)")} />
  );

  return (
    <div className="scrim" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 80, background: "rgba(0,0,0,.65)" }}>
      <div className="modal-pop" style={{ width: 420, background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 14, padding: "22px 22px 18px", boxShadow: "0 30px 80px rgba(0,0,0,.75)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 18 }}>{isNew ? "Add app" : `Edit — ${app!.name}`}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <div className="sec-label" style={{ marginBottom: 5 }}>App name</div>
            {inp(name, setName, "e.g. Gmail")}
          </div>
          <div>
            <div className="sec-label" style={{ marginBottom: 5 }}>Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["web","desktop"] as const).map(t => (
                <button key={t} onClick={() => setAppType(t)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid", fontSize: 12.5, fontWeight: 500, cursor: "pointer", background: appType === t ? "var(--accent)" : "var(--bg-surface)", borderColor: appType === t ? "var(--accent)" : "var(--border-md)", color: appType === t ? "#04122a" : "var(--text-muted)", textTransform: "capitalize", transition: "all .12s" }}>{t}</button>
              ))}
            </div>
          </div>
          {appType === "web" && (
            <div>
              <div className="sec-label" style={{ marginBottom: 5 }}>URL</div>
              {inp(url, setUrl, "https://...")}
            </div>
          )}
          <div>
            <div className="sec-label" style={{ marginBottom: 5 }}>Description</div>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="How should Click use this app?" rows={3}
              style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 9, padding: "9px 12px", fontSize: 13, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "none", display: "block", boxSizing: "border-box", lineHeight: 1.55 }}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
              onBlur={e => (e.currentTarget.style.borderColor = "var(--border-md)")} />
          </div>
          <div>
            <div className="sec-label" style={{ marginBottom: 5 }}>Credentials <span style={{ fontWeight: 400, color: "var(--text-hint)" }}>(optional)</span></div>
            {inp(email, setEmail, "Email")}
            <div style={{ position: "relative", marginTop: 7 }}>
              <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
                style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 9, padding: "9px 38px 9px 12px", fontSize: 13, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", boxSizing: "border-box", display: "block" }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
                onBlur={e => (e.currentTarget.style.borderColor = "var(--border-md)")} />
              <button onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-hint)", display: "grid", placeItems: "center" }}>
                <Icon name="eye" size={14} stroke={1.5} />
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={save} className="btn btn-primary" style={{ flex: 1.6 }}>{isNew ? "Add app" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ name, onConfirm, onClose }: { name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="scrim" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 90, background: "rgba(0,0,0,.7)" }}>
      <div className="modal-pop" style={{ width: 340, background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 14, padding: "22px 22px 18px", boxShadow: "0 30px 80px rgba(0,0,0,.8)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>Remove app?</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
          <strong style={{ color: "var(--text-primary)" }}>{name}</strong> will be removed. All saved instructions and credentials for this app will be deleted.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} className="btn btn-danger" style={{ flex: 1 }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function AppCard({ app, onEdit, onDelete }: { app: AppEntry; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "13px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,.06)", display: "grid", placeItems: "center", flex: "none", color: "var(--text-muted)" }}>
          <Icon name={app.app_type === "web" ? "globe" : "monitor"} size={16} stroke={1.5} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{app.name}</span>
            <span style={{ fontSize: 10.5, color: "var(--text-hint)", background: "rgba(255,255,255,.06)", borderRadius: 5, padding: "2px 7px", textTransform: "capitalize" }}>{app.app_type}</span>
          </div>
          {app.description && <div style={{ fontSize: 12, color: "var(--text-hint)", marginTop: 4, lineHeight: 1.45 }}>{app.description.slice(0, 80)}{app.description.length > 80 ? "…" : ""}</div>}
        </div>
        <div style={{ display: "flex", gap: 5, flex: "none" }}>
          <button onClick={onEdit} className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: "0 10px" }}>
            <Icon name="pencil" size={12} stroke={1.5} />
          </button>
          <button onClick={onDelete} className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: "0 10px", color: "var(--danger)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(229,72,77,.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}>
            <Icon name="trash" size={12} stroke={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen({ onClose, user, credits, onSignOut }: {
  onClose: () => void;
  user?: AuthUser | null;
  credits?: UserCredits | null;
  onSignOut?: () => void;
}) {
  const [section,    setSection   ] = useState("general");
  const [apps,       setApps      ] = useState<AppEntry[]>([]);
  const [memories,   setMemories  ] = useState<MemEntry[]>([]);
  const [appModal,   setAppModal  ] = useState<{ open: boolean; app: AppEntry | null }>({ open: false, app: null });
  const [delModal,   setDelModal  ] = useState<{ open: boolean; app: AppEntry | null }>({ open: false, app: null });
  const [theme,      setTheme     ] = useState("Dark");
  const [fontSize,   setFontSize  ] = useState("Medium");
  const [startupApp, setStartupApp] = useState("Last chat");
  const [pauseHrs,   setPauseHrs  ] = useState("8 hours");
  const [notifSound, setNotifSound] = useState(true);
  const [autoStart,  setAutoStart ] = useState(false);
  const [memEnabled, setMemEnabled] = useState(true);
  const [memEditId,  setMemEditId ] = useState<string | null>(null);
  const [memEditVal, setMemEditVal] = useState("");
  const [newMemVal,  setNewMemVal ] = useState("");
  const [addingMem,  setAddingMem ] = useState(false);

  useEffect(() => {
    getSettings().then(s => {
      if (!s) return;
      setAutoStart(s.launch_at_login === 1);
      setMemEnabled(s.memory_enabled === 1);
      if (s.theme) setTheme(s.theme === 'dark' ? 'Dark' : s.theme === 'light' ? 'Light' : 'System');
    });
    getApps().then(setApps);
    getMemoryEntries().then(setMemories);
  }, []);

  async function handleSaveApp(a: AppEntry) {
    await dbSaveApp(a);
    const rows = await getApps();
    setApps(rows);
    setAppModal({ open: false, app: null });
  }

  async function handleDeleteApp(id: string) {
    await dbDeleteApp(id);
    setApps(as => as.filter(a => a.id !== id));
    setDelModal({ open: false, app: null });
  }

  async function handleDeleteMem(id: string) {
    await deleteMemoryEntry(id);
    setMemories(ms => ms.filter(m => m.id !== id));
  }

  function startMemEdit(m: MemEntry) { setMemEditId(m.id); setMemEditVal(m.content); }

  async function saveMemEdit() {
    if (!memEditId) return;
    await updateMemoryEntry(memEditId, memEditVal);
    setMemories(ms => ms.map(m => m.id === memEditId ? { ...m, content: memEditVal } : m));
    setMemEditId(null);
  }

  async function handleAddMem() {
    if (!newMemVal.trim()) return;
    const id = uuidv4();
    await addMemoryEntry(id, newMemVal.trim());
    const rows = await getMemoryEntries();
    setMemories(rows);
    setNewMemVal("");
    setAddingMem(false);
  }

  async function handleToggleAutoStart(v: boolean) {
    setAutoStart(v);
    await updateSettings({ launch_at_login: v ? 1 : 0 });
  }

  async function handleToggleMemEnabled(v: boolean) {
    setMemEnabled(v);
    await updateSettings({ memory_enabled: v ? 1 : 0 });
  }

  async function handleThemeChange(v: string) {
    setTheme(v);
    await updateSettings({ theme: v.toLowerCase() });
  }

  async function handleClearMemories() {
    for (const m of memories) await deleteMemoryEntry(m.id);
    setMemories([]);
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,.65)" }}>
      <div className="modal-pop" style={{ width: 700, height: 500, background: "var(--bg-surface)", border: "1px solid var(--border-md)", borderRadius: 14, overflow: "hidden", display: "flex", boxShadow: "0 40px 100px rgba(0,0,0,.75)", position: "relative" }}>
        <aside style={{ width: 180, flex: "none", background: "var(--bg-app)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: "16px 10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px 16px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
            <ClickMark size={20} radius={6} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Settings</span>
          </div>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, border: "none", textAlign: "left", cursor: "pointer", background: section === s.id ? "var(--bg-elevated)" : "transparent", color: section === s.id ? "var(--text-primary)" : "var(--text-muted)", fontSize: 13, fontWeight: section === s.id ? 500 : 400, transition: "all .1s" }}
              onMouseEnter={e => { if (section !== s.id) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (section !== s.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <Icon name={s.icon} size={14} stroke={1.5} />
              {s.label}
            </button>
          ))}
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ height: 44, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 20px", flex: "none", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{SECTIONS.find(s => s.id === section)?.label}</span>
            <button onClick={onClose} style={{ color: "var(--text-hint)", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 5, borderRadius: 6, transition: "color .1s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-hint)")}>
              <Icon name="x" size={16} stroke={2} />
            </button>
          </div>

          <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "6px 20px 20px" }}>
            {section === "general" && (
              <>
                <SettingRow label="Startup screen" sub="Screen to show when the app launches"><Select value={startupApp} options={["Last chat","New chat","Scheduler"]} onChange={setStartupApp} /></SettingRow>
                <SettingRow label="Pause automation" sub="Temporarily suspend all tasks"><Select value={pauseHrs} options={["1 hour","4 hours","8 hours","Until tomorrow"]} onChange={setPauseHrs} /></SettingRow>
                <SettingRow label="Launch at startup" sub="Start Click when you log in"><Toggle checked={autoStart} onChange={handleToggleAutoStart} /></SettingRow>
                <SettingRow label="Notification sound" sub="Play a sound when tasks complete"><Toggle checked={notifSound} onChange={setNotifSound} /></SettingRow>
                <SettingRow label="Version" sub="Current installed build"><span style={{ fontSize: 12.5, color: "var(--text-hint)", fontFamily: "var(--font-mono)" }}>v1.8.2</span></SettingRow>
              </>
            )}

            {section === "appearance" && (
              <>
                <SettingRow label="Theme" sub="Colour scheme for the app"><Select value={theme} options={["Dark","System","Light"]} onChange={handleThemeChange} /></SettingRow>
                <SettingRow label="Font size" sub="Size of text across the app"><Select value={fontSize} options={["Small","Medium","Large"]} onChange={setFontSize} /></SettingRow>
              </>
            )}

            {section === "automation" && (
              <>
                <SettingRow label="Require confirmation" sub="Ask before submitting forms or clicking irreversible actions"><Toggle checked={true} onChange={() => {}} /></SettingRow>
                <SettingRow label="Screenshot interval" sub="How often Click captures the screen during tasks"><Select value="500ms" options={["250ms","500ms","1s","2s"]} onChange={() => {}} /></SettingRow>
                <SettingRow label="Max task duration" sub="Abort task if it runs longer than this"><Select value="15 minutes" options={["5 minutes","10 minutes","15 minutes","30 minutes","No limit"]} onChange={() => {}} /></SettingRow>
              </>
            )}

            {section === "behavior" && (
              <>
                <SettingRow label="Proactive suggestions" sub="Click suggests follow-up tasks based on context"><Toggle checked={true} onChange={() => {}} /></SettingRow>
                <SettingRow label="Learning mode" sub="Improve task performance from your corrections"><Toggle checked={true} onChange={() => {}} /></SettingRow>
                <SettingRow label="Verbose output" sub="Show detailed step-by-step actions in chat"><Toggle checked={false} onChange={() => {}} /></SettingRow>
              </>
            )}

            {section === "memory" && (
              <>
                <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 450 }}>Memory enabled</div>
                    <div style={{ fontSize: 12, color: "var(--text-hint)", marginTop: 2 }}>Remember context between sessions</div>
                  </div>
                  <Toggle checked={memEnabled} onChange={handleToggleMemEnabled} />
                </div>
                <div style={{ padding: "14px 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{user?.email?.split('@')[0] || 'User'}</span>
                  <span style={{ fontSize: 12, color: "var(--text-hint)", background: "var(--bg-elevated)", borderRadius: 6, padding: "3px 8px", border: "1px solid var(--border)" }}>{user?.email || ''}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {memories.map(m => (
                    <div key={m.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 9, padding: "11px 12px" }}>
                      {memEditId === m.id ? (
                        <>
                          <textarea value={memEditVal} onChange={e => setMemEditVal(e.target.value)} rows={3}
                            style={{ width: "100%", background: "var(--bg-surface)", border: "1px solid var(--accent)", borderRadius: 7, padding: "8px 10px", fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.55, resize: "none", fontFamily: "inherit", outline: "none", boxSizing: "border-box", display: "block" }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            <button onClick={() => setMemEditId(null)} className="btn btn-ghost" style={{ height: 26, fontSize: 11.5 }}>Cancel</button>
                            <button onClick={saveMemEdit} className="btn btn-primary" style={{ height: 26, fontSize: 11.5 }}>Save</button>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{m.content}</div>
                          <div style={{ display: "flex", gap: 3, flex: "none" }}>
                            <button onClick={() => startMemEdit(m)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-hint)", padding: 4, borderRadius: 5 }}>
                              <Icon name="pencil" size={12} stroke={1.5} />
                            </button>
                            <button onClick={() => handleDeleteMem(m.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4, borderRadius: 5 }}>
                              <Icon name="trash" size={12} stroke={1.5} />
                            </button>
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--text-hint)", marginTop: 5 }}>{formatDate(m.created_at)}</div>
                    </div>
                  ))}
                  {addingMem ? (
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--accent)", borderRadius: 9, padding: "11px 12px" }}>
                      <textarea value={newMemVal} onChange={e => setNewMemVal(e.target.value)} rows={3} autoFocus placeholder="Enter a memory entry…"
                        style={{ width: "100%", background: "var(--bg-surface)", border: "1px solid var(--border-md)", borderRadius: 7, padding: "8px 10px", fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.55, resize: "none", fontFamily: "inherit", outline: "none", boxSizing: "border-box", display: "block" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button onClick={() => { setAddingMem(false); setNewMemVal(""); }} className="btn btn-ghost" style={{ height: 26, fontSize: 11.5 }}>Cancel</button>
                        <button onClick={handleAddMem} className="btn btn-primary" style={{ height: 26, fontSize: 11.5 }}>Add</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setAddingMem(true)} className="btn btn-ghost" style={{ height: 30, fontSize: 12, alignSelf: "flex-start" }}>
                      <Icon name="plus" size={13} stroke={2} /> Add memory
                    </button>
                  )}
                </div>
              </>
            )}

            {section === "apps" && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 14px" }}>
                  <span style={{ fontSize: 13, color: "var(--text-hint)" }}>{apps.length} apps connected</span>
                  <button onClick={() => setAppModal({ open: true, app: null })} className="btn btn-primary" style={{ height: 30, fontSize: 12 }}>
                    <Icon name="plus" size={13} stroke={2} /> Add app
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {apps.map(a => (
                    <AppCard key={a.id} app={a}
                      onEdit={() => setAppModal({ open: true, app: a })}
                      onDelete={() => setDelModal({ open: true, app: a })} />
                  ))}
                </div>
              </>
            )}

            {section === "account" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ width: 52, height: 52, borderRadius: "50%", background: "#1A2535", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 700, color: "var(--text-primary)", border: "1px solid var(--border-md)", flex: "none" }}>
                    {user?.email ? emailInitials(user.email) : 'U'}
                  </span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{user?.email?.split('@')[0] || 'User'}</div>
                    <div style={{ fontSize: 13, color: "var(--text-hint)", marginTop: 2 }}>{user?.email || ''}</div>
                  </div>
                </div>
                <SettingRow label="Plan" sub="Your current subscription tier">
                  <span className="pill pill-blue" style={{ fontSize: 11, textTransform: "capitalize" }}>
                    {credits?.tier || 'Free'}
                  </span>
                </SettingRow>
                <SettingRow label="Credit balance" sub="UC used / available this month">
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {credits ? `${credits.uc_balance} / ${credits.monthly_uc_limit} UC` : '—'}
                  </span>
                </SettingRow>
                <div style={{ paddingTop: 12 }}>
                  <button onClick={onSignOut} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", height: 36, fontSize: 13, color: "var(--danger)" }}>
                    <Icon name="lock" size={14} stroke={1.5} /> Sign out
                  </button>
                </div>
              </>
            )}

            {section === "danger" && (
              <>
                <div style={{ background: "rgba(229,72,77,.06)", border: "1px solid rgba(229,72,77,.25)", borderRadius: 10, padding: "14px 16px", marginTop: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#E5484D", marginBottom: 6 }}>Danger zone</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>These actions are permanent and cannot be undone.</div>
                </div>
                <SettingRow label="Clear all memories" sub="Permanently delete all stored AI memory entries">
                  <button onClick={handleClearMemories} className="btn btn-danger" style={{ height: 30, fontSize: 12 }}>Clear memories</button>
                </SettingRow>
                <SettingRow label="Delete account" sub="Permanently delete your account and all data">
                  <button className="btn btn-danger" style={{ height: 30, fontSize: 12 }}>Delete account</button>
                </SettingRow>
              </>
            )}
          </div>
        </div>
      </div>

      {appModal.open && <AppFormModal app={appModal.app} onSave={handleSaveApp} onClose={() => setAppModal({ open: false, app: null })} />}
      {delModal.open && delModal.app && <DeleteConfirmModal name={delModal.app.name} onConfirm={() => handleDeleteApp(delModal.app!.id)} onClose={() => setDelModal({ open: false, app: null })} />}
    </div>
  );
}
