import { useState, useEffect } from 'react';
import { Icon, ClickMark } from './icons';
import { ACTION_TEMPLATES } from '../data';

const TARGETS = [
  { x: 612, y: 318, label: "Email address field" },
  { x: 612, y: 392, label: "Company field" },
  { x: 612, y: 466, label: "Plan selector" },
  { x: 612, y: 540, label: "Submit button" },
];

function Crosshair({ x, y, label, active }: { x: number; y: number; label: string; active: boolean }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
      <div className={active ? "xhair" : ""} style={{
        width: 28, height: 28, borderRadius: "50%",
        border: `1.5px solid ${active ? "rgba(74,158,255,0.9)" : "rgba(74,158,255,0.3)"}`,
        display: "grid", placeItems: "center",
        background: active ? "rgba(74,158,255,0.12)" : "transparent",
        transition: "all .3s",
      }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: active ? "var(--accent)" : "rgba(74,158,255,0.4)", transition: "all .3s" }} />
      </div>
      {active && (
        <div className="fade-up" style={{ position: "absolute", left: "calc(100% + 10px)", top: "50%", transform: "translateY(-50%)", whiteSpace: "nowrap", fontSize: 11, color: "var(--accent)", background: "rgba(74,158,255,0.1)", border: "1px solid rgba(74,158,255,0.3)", borderRadius: 6, padding: "3px 8px" }}>{label}</div>
      )}
    </div>
  );
}

function MockDesktop({ actionStep }: { actionStep: number }) {
  const fields = [
    { id: "email",   label: "Email address", value: actionStep >= 3 ? "alex@larund.io" : "" },
    { id: "company", label: "Company",        value: actionStep >= 5 ? "Larund Inc." : "" },
    { id: "plan",    label: "Plan",           value: "" },
  ];
  const plans = [
    { id: "starter", label: "Starter", price: "Free" },
    { id: "pro",     label: "Pro",     price: "€49/mo" },
    { id: "biz",     label: "Business",price: "€149/mo", selected: actionStep >= 7 },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "#0f1117" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 34, background: "#1A1D28", borderBottom: "1px solid rgba(var(--ov-color),.06)", display: "flex", alignItems: "center", padding: "0 14px", gap: 10, flex: "none" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["#EC6A5E","#F5BE4E","#61C554"].map((c, i) => <div key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />)}
          </div>
          <div style={{ flex: 1, background: "rgba(var(--ov-color),.05)", borderRadius: 5, height: 22, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "rgba(var(--ov-color),.35)" }}>
            https://vendor.example.com/signup
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px" }}>
          <div style={{ width: 460, background: "#fff", borderRadius: 14, padding: "32px 36px", boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 4 }}>Create your account</div>
              <div style={{ fontSize: 13.5, color: "#777" }}>Start your free trial. No credit card required.</div>
            </div>
            {fields.map(f => (
              <div key={f.id} style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: "#444", display: "block", marginBottom: 5 }}>{f.label}</label>
                <div style={{ height: 42, background: "#f7f8fa", border: "1.5px solid", borderColor: f.value ? "#4A9EFF" : "#e0e2e8", borderRadius: 8, display: "flex", alignItems: "center", padding: "0 13px", fontSize: 13.5, color: f.value ? "#111" : "#bbb", fontFamily: "monospace", transition: "border-color .2s" }}>
                  {f.value || f.label}
                </div>
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "#444", display: "block", marginBottom: 5 }}>Plan</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {plans.map(p => (
                  <div key={p.id} style={{ padding: "12px 10px", border: "1.5px solid", borderColor: p.selected ? "#4A9EFF" : "#e0e2e8", borderRadius: 8, cursor: "pointer", background: p.selected ? "#EAF3FF" : "#fff", transition: "all .2s" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: p.selected ? "#1a5fa8" : "#333" }}>{p.label}</div>
                    <div style={{ fontSize: 12, color: p.selected ? "#2d7dd2" : "#888", marginTop: 2 }}>{p.price}</div>
                  </div>
                ))}
              </div>
            </div>
            <button style={{ width: "100%", height: 44, background: actionStep >= 8 ? "#4A9EFF" : "#d0d5dd", borderRadius: 9, border: "none", fontSize: 14, fontWeight: 600, color: actionStep >= 8 ? "#fff" : "#aaa", cursor: "pointer", transition: "all .3s" }}>
              Create Account
            </button>
          </div>
        </div>
      </div>

      {TARGETS.map((t, i) => (
        <Crosshair key={i} x={t.x} y={t.y} label={t.label} active={actionStep === i * 2 + 1 || actionStep === i * 2 + 2} />
      ))}
    </div>
  );
}

function ActionFeed({ items }: { items: typeof ACTION_TEMPLATES }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item, i) => (
        <div key={i} className="feed-row fade-up" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: item.color + "1a", color: item.color, display: "grid", placeItems: "center", flex: "none", marginTop: 1 }}>
            <Icon name={item.icon} size={13} stroke={1.5} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.4 }}>{item.text}</div>
            <div style={{ fontSize: 11, color: "var(--text-hint)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{item.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ onConfirm, onDismiss }: { onConfirm: () => void; onDismiss: () => void }) {
  return (
    <div className="scrim" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 40, background: "rgba(0,0,0,.55)" }}>
      <div className="modal-pop" style={{ width: 340, background: "var(--bg-elevated)", border: "1px solid var(--border-md)", borderRadius: 14, padding: "24px 24px 20px", boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(245,165,36,.12)", color: "#F5A524", display: "grid", placeItems: "center", flex: "none" }}>
            <Icon name="alert" size={20} stroke={1.5} />
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Review before submit</div>
            <div style={{ fontSize: 12.5, color: "var(--text-hint)", marginTop: 1 }}>This action cannot be undone</div>
          </div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            I've filled in all required fields on the vendor signup form. Ready to submit and create the account with the <strong style={{ color: "var(--text-primary)" }}>Business plan</strong> at <strong style={{ color: "var(--text-primary)" }}>€149/mo</strong>.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onDismiss} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
          <button onClick={onConfirm} className="btn btn-primary" style={{ flex: 1.6 }}>
            <Icon name="check" size={14} stroke={2.5} /> Submit form
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiveScreen({ nav }: { nav: (s: string) => void }) {
  const [actionStep,   setActionStep  ] = useState(0);
  const [visibleItems, setVisibleItems ] = useState<typeof ACTION_TEMPLATES>([]);
  const [showModal,    setShowModal   ] = useState(false);
  const [done,         setDone        ] = useState(false);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setActionStep(s => {
        const next = s + 1;
        if (next > ACTION_TEMPLATES.length) { clearInterval(id); setShowModal(true); return s; }
        setVisibleItems(ACTION_TEMPLATES.slice(0, next));
        return next;
      });
    }, 900);
    return () => clearInterval(id);
  }, [done]);

  function handleConfirm() { setShowModal(false); setDone(true); }
  function handleDismiss() { setShowModal(false); setDone(true); }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "var(--bg-app)", position: "relative" }}>
      <div style={{ height: 42, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 14px", gap: 10, flex: "none" }}>
        <button onClick={() => nav("chat")} style={{ color: "var(--text-hint)", background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 5, borderRadius: 6, transition: "color .1s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-muted)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-hint)")}>
          <Icon name="arrowLeft" size={16} stroke={2} />
        </button>
        <ClickMark size={18} radius={6} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Live</span>
        <div style={{ flex: 1 }} />
        {!done && (
          <span className="pill pill-blue" style={{ fontSize: 11 }}>
            <span className="dot dot-blue dot-pulse" />
            Running
          </span>
        )}
        {done && <span className="pill pill-green" style={{ fontSize: 11 }}><Icon name="check" size={11} stroke={2.5} />Done</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <MockDesktop actionStep={actionStep} />

        <div style={{ width: 300, flex: "none", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flex: "none" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>Fill out vendor signup form</div>
            <div style={{ fontSize: 12, color: "var(--text-hint)" }}>Using saved profile · Business plan</div>
          </div>
          <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "12px 12px" }}>
            <div className="sec-label" style={{ marginBottom: 8 }}>Actions</div>
            <ActionFeed items={visibleItems} />
          </div>
          {!done && (
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", flex: "none" }}>
              <button onClick={() => { setDone(true); setShowModal(false); }} className="btn btn-danger" style={{ width: "100%", height: 32, fontSize: 12 }}>
                <Icon name="stop" size={13} stroke={2} fill="current" /> Stop task
              </button>
            </div>
          )}
        </div>
      </div>

      {showModal && <ConfirmModal onConfirm={handleConfirm} onDismiss={handleDismiss} />}
    </div>
  );
}
