import React, { useState, useEffect, useRef } from 'react';
import { Icon, CatChip } from './icons';
import {
  getScheduledTasks, saveScheduledTask, deleteScheduledTask,
  getScheduledRuns, getApps,
} from '../lib/database';
import { v4 as uuidv4 } from 'uuid';

type RunStatus = "done" | "failed";
type Run = { date: string; dur: string; status: RunStatus };
type Task = {
  id: string; icon: string; color: string; title: string; desc: string;
  schedule: string; enabled: boolean; freq: string; time: string; days: number[];
  instructions: string; runs: Run[];
};
type MentionApp = { id: string; name: string; app_type: string };

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const FREQ_OPTS = ["Daily", "Weekdays", "Weekends", "Custom"];

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function daysToFreq(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Daily';
  if (JSON.stringify(sorted) === JSON.stringify([1,2,3,4,5])) return 'Weekdays';
  if (JSON.stringify(sorted) === JSON.stringify([0,6])) return 'Weekends';
  return 'Custom';
}

function buildScheduleStr(days: number[], time: string): string {
  const freq = daysToFreq(days);
  const t = fmtTime(time);
  if (freq === 'Daily') return `Daily · ${t}`;
  if (freq === 'Weekdays') return `Every weekday · ${t}`;
  if (freq === 'Weekends') return `Weekends · ${t}`;
  return `Custom · ${t}`;
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${String(s).padStart(2,'0')}s`;
}

function dbRowToTask(row: any, runs: any[]): Task {
  const days: number[] = (() => { try { return JSON.parse(row.repeat_days || '[]'); } catch { return []; } })();
  return {
    id: row.id,
    icon: row.icon || 'clock',
    color: row.color || '#8A8783',
    title: row.title,
    desc: row.description || '',
    schedule: buildScheduleStr(days, row.repeat_time || '09:00'),
    enabled: row.is_enabled === 1,
    freq: daysToFreq(days),
    time: row.repeat_time || '09:00',
    days,
    instructions: row.instructions || '',
    runs: runs.map(r => ({
      date: r.started_at ? new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
      dur: r.duration_ms ? formatDuration(r.duration_ms) : '—',
      status: (r.status === 'completed' ? 'done' : 'failed') as RunStatus,
    })),
  };
}

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const hr12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  function setHour(delta: number) {
    const nh = (h + delta + 24) % 24;
    onChange(String(nh).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
  }
  function setMin(delta: number) {
    const nm = (m + delta + 60) % 60;
    onChange(String(h).padStart(2, "0") + ":" + String(nm).padStart(2, "0"));
  }
  function toggleAMPM() {
    const nh = h < 12 ? h + 12 : h - 12;
    onChange(String(nh).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
  }
  const spinStyle = (dir: "up" | "down"): React.CSSProperties => ({
    display: "grid", placeItems: "center", cursor: "pointer", padding: "2px 6px",
    color: "var(--text-hint)", background: "none", border: "none",
    transform: dir === "up" ? "rotate(180deg)" : undefined
  });
  const valStyle: React.CSSProperties = {
    fontSize: 22, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums", textAlign: "center"
  };
  const col = (v: string, step: () => void, stepDown: () => void) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <button style={spinStyle("up")} onClick={step}><Icon name="chevronDown" size={16} stroke={2} /></button>
      <span style={valStyle}>{v}</span>
      <button style={spinStyle("down")} onClick={stepDown}><Icon name="chevronDown" size={16} stroke={2} /></button>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", borderRadius: 12, padding: "12px 18px", border: "1px solid var(--border)" }}>
      {col(String(hr12).padStart(2, "0"), () => setHour(1), () => setHour(-1))}
      <span style={{ fontSize: 22, fontWeight: 600, color: "var(--text-hint)", alignSelf: "center", marginBottom: 2 }}>:</span>
      {col(String(m).padStart(2, "0"), () => setMin(5), () => setMin(-5))}
      <button onClick={toggleAMPM} style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", background: "rgba(var(--accent-rgb),.13)", border: "none", borderRadius: 7, padding: "5px 10px", cursor: "pointer", marginLeft: 6 }}>{ampm}</button>
    </div>
  );
}

function MentionInput({ value, onChange, placeholder, apps }: {
  value: string; onChange: (v: string) => void; placeholder?: string; apps: MentionApp[];
}) {
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQ, setSuggestQ]     = useState("");
  const [caretPos, setCaretPos]     = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    onChange(v);
    const cursor = e.target.selectionStart;
    const before = v.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    if (match) { setSuggestQ(match[1]); setShowSuggest(true); }
    else setShowSuggest(false);
    setCaretPos(cursor);
    const ta = taRef.current!;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  function insertMention(name: string) {
    const before = value.slice(0, caretPos);
    const after  = value.slice(caretPos);
    const replaced = before.replace(/@(\w*)$/, "@" + name + " ");
    onChange(replaced + after);
    setShowSuggest(false);
    setTimeout(() => { if (taRef.current) { taRef.current.focus(); const p = replaced.length; taRef.current.setSelectionRange(p, p); } }, 0);
  }

  const filtered = apps.filter(a => a.name.toLowerCase().startsWith(suggestQ.toLowerCase()));

  return (
    <div style={{ position: "relative" }}>
      <textarea ref={taRef} value={value} onChange={handleInput} placeholder={placeholder} rows={3}
        style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, resize: "none", minHeight: 88, maxHeight: 200, fontFamily: "inherit", outline: "none", boxSizing: "border-box", display: "block" }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
        onBlur={e => { e.currentTarget.style.borderColor = "var(--border-md)"; setTimeout(() => setShowSuggest(false), 120); }} />
      {showSuggest && filtered.length > 0 && (
        <div className="fade-up" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 200, background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 9, padding: 4, boxShadow: "0 -14px 40px rgba(0,0,0,.6)", zIndex: 20 }}>
          {filtered.map(a => (
            <button key={a.id} onMouseDown={() => insertMention(a.name)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--text-primary)", background: "none", border: "none", cursor: "pointer", transition: "background .1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <span style={{ width: 20, height: 20, borderRadius: 5, background: "rgba(var(--ov-color),.07)", display: "grid", placeItems: "center", flex: "none" }}>
                <Icon name={a.app_type === "web" ? "globe" : "monitor"} size={12} stroke={1.5} style={{ color: "var(--accent)" }} />
              </span>
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskEditor({ task, apps, onSave, onClose, onDelete }: {
  task: Task | null; apps: MentionApp[];
  onSave: (t: Task) => void; onClose: () => void; onDelete?: (id: string) => void;
}) {
  const isNew = task === null;
  const [title,   setTitle  ] = useState(task?.title || "");
  const [desc,    setDesc   ] = useState(task?.desc  || "");
  const [instrs,  setInstrs ] = useState(task?.instructions || "");
  const [freq,    setFreq   ] = useState(task?.freq  || "Daily");
  const [time,    setTime   ] = useState(task?.time  || "09:00");
  const [days,    setDays   ] = useState<number[]>(task?.days || [1,2,3,4,5]);
  const [enabled, setEnabled] = useState(task?.enabled ?? true);

  function toggleDay(d: number) {
    setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort((a,b) => a-b));
  }

  function save() {
    if (!title.trim()) return;
    const schedStr = buildScheduleStr(days, time);
    onSave({
      id: task?.id || uuidv4(),
      icon: task?.icon || "clock",
      color: task?.color || "#A09D98",
      title: title.trim(),
      desc: desc.trim(),
      schedule: schedStr,
      enabled, freq, time, days,
      instructions: instrs,
      runs: task?.runs || [],
    });
  }

  const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", boxSizing: "border-box", display: "block" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onClose} style={{ color: "var(--text-hint)", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 4, borderRadius: 5 }}>
          <Icon name="arrowLeft" size={16} stroke={2} />
        </button>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{isNew ? "New task" : "Edit task"}</span>
        {!isNew && onDelete && (
          <button onClick={() => onDelete!(task!.id)} style={{ color: "var(--danger)", background: "none", border: "none", cursor: "pointer", padding: "5px 9px", borderRadius: 7, fontSize: 12.5 }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(229,72,77,.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
            Delete
          </button>
        )}
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div className="sec-label" style={{ marginBottom: 6 }}>Name</div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Morning email digest" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border-md)")} />
        </div>
        <div>
          <div className="sec-label" style={{ marginBottom: 6 }}>Description</div>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Short description" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border-md)")} />
        </div>
        <div>
          <div className="sec-label" style={{ marginBottom: 10 }}>Time</div>
          <TimePicker value={time} onChange={setTime} />
        </div>
        <div>
          <div className="sec-label" style={{ marginBottom: 8 }}>Frequency</div>
          <div style={{ display: "flex", gap: 5 }}>
            {FREQ_OPTS.map(opt => (
              <button key={opt} onClick={() => setFreq(opt)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid", fontSize: 12, fontWeight: 500, cursor: "pointer", background: freq === opt ? "var(--accent)" : "var(--bg-elevated)", borderColor: freq === opt ? "var(--accent)" : "var(--border-md)", color: freq === opt ? "var(--on-accent)" : "var(--text-muted)", transition: "all .12s" }}>{opt}</button>
            ))}
          </div>
        </div>
        {(freq === "Custom" || freq === "Weekdays" || freq === "Weekends") && (
          <div>
            <div className="sec-label" style={{ marginBottom: 8 }}>Days</div>
            <div style={{ display: "flex", gap: 6 }}>
              {DAY_LABELS.map((lbl, i) => {
                const on = days.includes(i);
                return (
                  <button key={i} onClick={() => toggleDay(i)} style={{ flex: 1, height: 34, borderRadius: 7, border: "1px solid", fontSize: 12, fontWeight: 500, cursor: "pointer", background: on ? "rgba(var(--accent-rgb),.15)" : "var(--bg-elevated)", borderColor: on ? "var(--accent)" : "var(--border)", color: on ? "var(--accent)" : "var(--text-hint)", transition: "all .12s" }}>{lbl}</button>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <div className="sec-label" style={{ marginBottom: 6 }}>Instructions <span style={{ color: "var(--text-hint)", fontWeight: 400 }}>— use @ to mention apps</span></div>
          <MentionInput value={instrs} onChange={setInstrs} placeholder="Describe what Click should do. Use @ to reference apps." apps={apps} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-elevated)", borderRadius: 10, padding: "11px 14px", border: "1px solid var(--border)" }}>
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Enable task</span>
          <button onClick={() => setEnabled(v => !v)} style={{ width: 38, height: 22, borderRadius: 11, background: enabled ? "var(--accent)" : "rgba(var(--ov-color),.1)", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
            <span style={{ position: "absolute", top: 3, left: enabled ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", display: "block" }} />
          </button>
        </div>
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
        <button onClick={save} className="btn btn-primary" style={{ flex: 2 }}>{isNew ? "Create task" : "Save changes"}</button>
      </div>
    </div>
  );
}

function SchTaskCard({ task, active, onClick }: { task: Task; active: boolean; onClick: () => void }) {
  const nextRun = task.enabled ? task.schedule.split("·")[1]?.trim() || "" : "Disabled";
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, border: "1px solid", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "rgba(var(--accent-rgb),.06)" : "var(--bg-elevated)", cursor: "pointer", transition: "all .12s" }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-md)"; } }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
      <CatChip name={task.icon} color={task.color} size={36} iconSize={17} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</div>
        <div style={{ fontSize: 12, color: "var(--text-hint)", marginTop: 2 }}>{task.desc}</div>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        <div style={{ fontSize: 12, color: task.enabled ? "var(--text-muted)" : "var(--text-hint)", fontWeight: 500 }}>{nextRun}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end", marginTop: 3 }}>
          {task.runs.slice(-3).map((r, i) => (
            <span key={i} title={`${r.date}: ${r.dur}`} style={{ width: 6, height: 6, borderRadius: "50%", background: r.status === "done" ? "var(--success)" : "var(--danger)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EditorEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, padding: "0 40px", background: "var(--bg-surface)", borderLeft: "1px solid var(--border)" }}>
      <span style={{ width: 46, height: 46, borderRadius: 13, background: "var(--bg-elevated)", display: "grid", placeItems: "center", color: "var(--text-hint)" }}>
        <Icon name="calendar" size={22} stroke={1.5} />
      </span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>No task selected</div>
        <div style={{ fontSize: 13, color: "var(--text-hint)" }}>Click a task to edit it, or create a new one.</div>
      </div>
      <button onClick={onNew} className="btn btn-primary" style={{ marginTop: 4 }}>
        <Icon name="plus" size={14} stroke={2} /> New scheduled task
      </button>
    </div>
  );
}

function TaskDetail({ task, onEdit }: { task: Task; onEdit: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <CatChip name={task.icon} color={task.color} size={36} iconSize={17} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }}>{task.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-hint)", marginTop: 2 }}>{task.schedule}</div>
        </div>
        <button onClick={onEdit} className="btn btn-ghost" style={{ height: 30, fontSize: 12 }}>
          <Icon name="pencil" size={13} stroke={1.5} /> Edit
        </button>
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "18px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div className="sec-label" style={{ marginBottom: 8 }}>Instructions</div>
          <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, border: "1px solid var(--border)", whiteSpace: "pre-wrap" }}>{task.instructions}</div>
        </div>
        {task.runs.length > 0 && (
          <div>
            <div className="sec-label" style={{ marginBottom: 8 }}>Run history</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {task.runs.map((r, i) => (
                <div key={i} className="feed-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                  <span style={{ color: r.status === "done" ? "var(--success)" : "var(--danger)", flex: "none" }}>
                    {r.status === "done" ? <Icon name="check" size={13} stroke={2.5} /> : <Icon name="x" size={13} stroke={2.5} />}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--text-muted)" }}>{r.date}</span>
                  <span style={{ fontSize: 12, color: "var(--text-hint)", fontFamily: "var(--font-mono)" }}>{r.dur}</span>
                  <span className={r.status === "done" ? "pill pill-green" : "pill pill-red"} style={{ fontSize: 10.5 }}>
                    {r.status === "done" ? "Success" : "Failed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SchedulerScreen({ nav }: { nav: (s: string) => void }) {
  const [tasks,    setTasks   ] = useState<Task[]>([]);
  const [apps,     setApps    ] = useState<MentionApp[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing,  setEditing ] = useState(false);

  useEffect(() => {
    loadTasks();
    getApps().then(rows => setApps(rows.map(r => ({ id: r.id, name: r.name, app_type: r.app_type }))));
  }, []);

  async function loadTasks() {
    const rows = await getScheduledTasks();
    const tasksWithRuns = await Promise.all(rows.map(async row => {
      const runs = await getScheduledRuns(row.id);
      return dbRowToTask(row, runs);
    }));
    setTasks(tasksWithRuns);
  }

  async function handleSave(t: Task) {
    await saveScheduledTask({
      id: t.id,
      title: t.title,
      description: t.desc,
      model: 'core',
      is_enabled: t.enabled,
      task_type: 'recurring',
      run_at: null,
      repeat_days: t.days,
      repeat_time: t.time,
      instructions: t.instructions,
      icon: t.icon,
      color: t.color,
    });
    await loadTasks();
    setActiveId(t.id);
    setEditing(false);
  }

  async function handleDelete(id: string) {
    await deleteScheduledTask(id);
    await loadTasks();
    setActiveId(null);
    setEditing(false);
  }

  const activeTask = tasks.find(t => t.id === activeId) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "var(--bg-app)" }}>
      <div style={{ height: 42, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 14px", gap: 10, flex: "none" }}>
        <button onClick={() => nav("chat")} style={{ color: "var(--text-hint)", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 5, borderRadius: 6, transition: "color .1s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-muted)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-hint)")}>
          <Icon name="arrowLeft" size={16} stroke={2} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Scheduler</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => { setActiveId(null); setEditing(true); }} className="btn btn-primary" style={{ height: 30, fontSize: 12 }}>
          <Icon name="plus" size={13} stroke={2} /> New task
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ width: 280, flex: "none", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
            {tasks.length === 0 && <div style={{ fontSize: 13, color: "var(--text-hint)", textAlign: "center", marginTop: 40 }}>No scheduled tasks</div>}
            {tasks.map(t => (
              <SchTaskCard key={t.id} task={t} active={activeId === t.id} onClick={() => { setActiveId(t.id); setEditing(false); }} />
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <TaskEditor
              task={activeId ? (tasks.find(t => t.id === activeId) ?? null) : null}
              apps={apps}
              onSave={handleSave}
              onClose={() => setEditing(false)}
              onDelete={handleDelete}
            />
          ) : activeTask ? (
            <TaskDetail task={activeTask} onEdit={() => setEditing(true)} />
          ) : (
            <EditorEmptyState onNew={() => { setActiveId(null); setEditing(true); }} />
          )}
        </div>
      </div>
    </div>
  );
}
