import { useState, useEffect } from 'react';
import { Icon, ClickMark } from '../components/icons';
import { getUserCredits } from '../lib/supabase';
import type { AuthUser } from '../lib/auth';
import type { UserCredits } from '../lib/supabase';

type AutonomyMode = 'full' | 'semi' | 'manual';

const MODE_NAMES: Record<AutonomyMode, string> = {
  full: 'Full Autonomous',
  semi: 'Semi-Autonomous',
  manual: 'Manual',
};

async function saveOnboardingData(autonomyMode: AutonomyMode) {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('auth.dat');
    await store.set('onboarding_complete', true);
    await store.set('autonomy_mode', autonomyMode);
    await store.save();
    return;
  } catch {}
  localStorage.setItem('onboarding_complete', 'true');
  localStorage.setItem('autonomy_mode', autonomyMode);
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepDot({ n, current }: { n: number; current: number }) {
  const done   = current > n;
  const active = current === n;
  return (
    <span style={{
      width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
      fontSize: 11, fontWeight: 700, flex: 'none', transition: 'all .2s',
      background: active ? 'var(--accent)' : done ? 'rgba(62,207,142,.18)' : 'var(--bg-elevated)',
      color: active ? '#04122a' : done ? 'var(--success)' : 'var(--text-hint)',
      border: `1.5px solid ${active ? 'var(--accent)' : done ? 'rgba(62,207,142,.45)' : 'var(--border-md)'}`,
    }}>
      {done ? <Icon name="check" size={11} stroke={2.5} /> : n}
    </span>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '12px 0 20px' }}>
      {[1, 2, 3, 4, 5].map((n, i) => (
        <span key={n} style={{ display: 'flex', alignItems: 'center' }}>
          <StepDot n={n} current={step} />
          {i < 4 && (
            <span style={{
              width: 36, height: 1.5,
              background: step > n ? 'rgba(62,207,142,.4)' : 'var(--border)',
              transition: 'background .3s',
            }} />
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Step 1 — Welcome ────────────────────────────────────────────────────────

const FEATURES = [
  { icon: 'zap',      bg: 'rgba(245,165,36,.13)', color: '#F5A524', title: 'Automates anything',  desc: 'Opens apps, fills forms, clicks buttons' },
  { icon: 'calendar', bg: 'rgba(74,158,255,.13)',  color: 'var(--accent)',  title: 'Scheduled tasks',    desc: 'Runs tasks automatically while you sleep' },
  { icon: 'eye',      bg: 'rgba(62,207,142,.13)',  color: 'var(--success)', title: 'Sees your screen',   desc: 'Understands what\'s on your display' },
  { icon: 'lock',     bg: 'rgba(139,92,246,.13)',  color: '#8B5CF6',       title: 'Always in control',  desc: 'Pauses and asks before risky actions' },
];

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, textAlign: 'center' }}>
        Meet Larund Click
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 24, textAlign: 'center', lineHeight: 1.5 }}>
        Your AI that actually does things on your computer.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 28 }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 14px',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9, background: f.bg,
              display: 'grid', placeItems: 'center', marginBottom: 10,
            }}>
              <Icon name={f.icon} size={16} stroke={1.5} style={{ color: f.color }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{f.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', lineHeight: 1.4 }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <button onClick={onNext} className="btn btn-primary"
        style={{ width: '100%', height: 44, fontSize: 14, fontWeight: 600, justifyContent: 'center' }}>
        Get started →
      </button>
    </div>
  );
}

// ─── Step 2 — Permissions ────────────────────────────────────────────────────

function PermCard({ icon, title, desc, granted, onGrant }: {
  icon: string; title: string; desc: string; granted: boolean; onGrant: () => void;
}) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: `1px solid ${granted ? 'rgba(62,207,142,.35)' : 'var(--border-md)'}`,
      borderLeft: `3px solid ${granted ? 'var(--success)' : 'var(--border-md)'}`,
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'border-color .2s',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9, flex: 'none',
        background: granted ? 'rgba(62,207,142,.12)' : 'rgba(255,255,255,.05)',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name={icon} size={17} stroke={1.5}
          style={{ color: granted ? 'var(--success)' : 'var(--text-muted)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', lineHeight: 1.4 }}>{desc}</div>
      </div>
      {granted ? (
        <span style={{
          fontSize: 11.5, fontWeight: 600, color: 'var(--success)',
          background: 'rgba(62,207,142,.12)', border: '1px solid rgba(62,207,142,.28)',
          borderRadius: 6, padding: '5px 11px', flex: 'none', whiteSpace: 'nowrap',
        }}>✓ Granted</span>
      ) : (
        <button onClick={onGrant} className="btn btn-primary"
          style={{ height: 32, fontSize: 12, padding: '0 14px', flex: 'none' }}>
          Grant
        </button>
      )}
    </div>
  );
}

function StepPermissions({ onNext, screenGranted, accessGranted, setScreenGranted, setAccessGranted }: {
  onNext: () => void;
  screenGranted: boolean; accessGranted: boolean;
  setScreenGranted: (v: boolean) => void; setAccessGranted: (v: boolean) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        Grant permissions
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
        Click needs these to automate tasks on your computer.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        <PermCard
          icon="monitor" title="Screen Recording"
          desc="Allows Click to see your screen and understand what's happening."
          granted={screenGranted}
          onGrant={() => setScreenGranted(true)}
        />
        <PermCard
          icon="pointer" title="Mouse & Keyboard (Accessibility)"
          desc="Allows Click to control your cursor and keyboard to complete tasks."
          granted={accessGranted}
          onGrant={() => setAccessGranted(true)}
        />
      </div>
      <button onClick={onNext} className="btn btn-primary"
        style={{ width: '100%', height: 44, fontSize: 14, fontWeight: 600, justifyContent: 'center' }}>
        Continue
      </button>
    </div>
  );
}

// ─── Step 3 — Autonomy Mode ──────────────────────────────────────────────────

const MODES: { id: AutonomyMode; iconBg: string; iconColor: string; icon: string; title: string; desc: string; badge?: string }[] = [
  {
    id: 'full', icon: 'zap', iconBg: 'rgba(245,165,36,.15)', iconColor: '#F5A524',
    title: 'Full Autonomous',
    desc: 'Click executes everything without asking. Best for trusted, repetitive tasks.',
  },
  {
    id: 'semi', icon: 'shield', iconBg: 'rgba(74,158,255,.15)', iconColor: 'var(--accent)',
    title: 'Semi-Autonomous', badge: 'Recommended',
    desc: 'Click pauses before irreversible actions like sending emails or deleting files.',
  },
  {
    id: 'manual', icon: 'pointer', iconBg: 'rgba(139,92,246,.15)', iconColor: '#8B5CF6',
    title: 'Manual',
    desc: 'Click pauses and asks your approval at every single step.',
  },
];

function StepAutonomy({ mode, setMode, onNext }: {
  mode: AutonomyMode; setMode: (m: AutonomyMode) => void; onNext: () => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        How much should Click decide?
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
        You can change this anytime in Settings.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {MODES.map(m => {
          const sel = mode === m.id;
          return (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              background: sel ? 'rgba(74,158,255,.08)' : 'var(--bg-elevated)',
              border: `1px solid ${sel ? 'var(--accent)' : 'var(--border-md)'}`,
              borderLeft: `3px solid ${sel ? 'var(--accent)' : 'var(--border-md)'}`,
              borderRadius: 10, padding: '13px 14px',
              textAlign: 'left', cursor: 'pointer', transition: 'all .15s',
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, background: m.iconBg,
                display: 'grid', placeItems: 'center', flex: 'none',
              }}>
                <Icon name={m.icon} size={16} stroke={1.5} style={{ color: m.iconColor }} />
              </div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: sel ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {m.title}
                  </span>
                  {m.badge && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, color: 'var(--accent)',
                      background: 'rgba(74,158,255,.15)', border: '1px solid rgba(74,158,255,.3)',
                      borderRadius: 5, padding: '2px 7px',
                    }}>{m.badge}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-hint)', lineHeight: 1.4 }}>{m.desc}</div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flex: 'none',
                border: `2px solid ${sel ? 'var(--accent)' : 'var(--border-md)'}`,
                background: sel ? 'var(--accent)' : 'transparent',
                display: 'grid', placeItems: 'center',
              }}>
                {sel && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#04122a' }} />}
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={onNext} className="btn btn-primary"
        style={{ width: '100%', height: 44, fontSize: 14, fontWeight: 600, justifyContent: 'center' }}>
        Continue
      </button>
    </div>
  );
}

// ─── Step 4 — How it works ───────────────────────────────────────────────────

const HOW_STEPS = [
  {
    title: 'You describe the task',
    desc: 'Type what you want in plain language. For example: "Reply to my unread support emails" or "Export Q2 invoices to PDF".',
  },
  {
    title: 'Click plans and executes',
    desc: 'Click sees your screen, moves the mouse, types, clicks — exactly like a human would. It works across any app on your computer.',
  },
  {
    title: 'You stay in control',
    desc: 'Watch live as it works. Pause or stop anytime. In Semi mode, Click asks before any irreversible action.',
  },
];

function StepHowItWorks({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        Here's how Click works
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
        Three simple steps, every time.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 18 }}>
        {HOW_STEPS.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{
              width: 32, height: 32, borderRadius: '50%', flex: 'none',
              background: 'rgba(74,158,255,.12)', border: '1px solid rgba(74,158,255,.25)',
              display: 'grid', placeItems: 'center',
              fontSize: 14, fontWeight: 700, color: 'var(--accent)',
            }}>{i + 1}</span>
            <div style={{ paddingTop: 4 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 5 }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{
        background: 'rgba(245,165,36,.07)', border: '1px solid rgba(245,165,36,.25)',
        borderRadius: 9, padding: '12px 14px', marginBottom: 24,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <Icon name="alert" size={15} stroke={1.5} style={{ color: 'var(--warning)', flex: 'none', marginTop: 2 }} />
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> Start with simple tasks like "Open Notion and create a new page"
          to see how Click works before trusting it with important workflows.
        </span>
      </div>
      <button onClick={onNext} className="btn btn-primary"
        style={{ width: '100%', height: 44, fontSize: 14, fontWeight: 600, justifyContent: 'center' }}>
        Continue
      </button>
    </div>
  );
}

// ─── Step 5 — All Set ────────────────────────────────────────────────────────

function StepAllSet({ user, mode, screenGranted, accessGranted, onComplete }: {
  user: AuthUser; mode: AutonomyMode; screenGranted: boolean; accessGranted: boolean;
  onComplete: () => void;
}) {
  const [credits,  setCredits ] = useState<UserCredits | null>(null);
  const [credErr,  setCredErr ] = useState(false);
  const [saving,   setSaving  ] = useState(false);

  useEffect(() => {
    getUserCredits(user.id)
      .then(c => { if (c) setCredits(c); else setCredErr(true); })
      .catch(() => setCredErr(true));
  }, [user.id]);

  async function handleStart() {
    setSaving(true);
    await saveOnboardingData(mode);
    onComplete();
  }

  const firstName = user.email.split('@')[0];
  const checkItems = [
    { label: `Screen Recording — ${screenGranted ? 'Granted' : 'Skipped'}`, ok: screenGranted },
    { label: `Mouse & Keyboard — ${accessGranted ? 'Granted' : 'Skipped'}`, ok: accessGranted },
    { label: `Autonomy mode — ${MODE_NAMES[mode]}`, ok: true },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        You're all set, {firstName}!
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
        Your Larund Click is ready to work for you.
      </p>

      {/* Credits card */}
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-md)',
        borderRadius: 12, padding: '16px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, background: 'rgba(74,158,255,.15)',
          display: 'grid', placeItems: 'center', flex: 'none',
        }}>
          <Icon name="zap" size={18} stroke={1.5} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginBottom: 3, fontWeight: 500 }}>Larund Credits</div>
          {credErr ? (
            <div style={{ fontSize: 13, color: 'var(--text-hint)' }}>Credits unavailable</div>
          ) : credits ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                {Number(credits.uc_balance).toFixed(2)} UC
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
                {credits.monthly_uc_limit} UC monthly limit · <span style={{ textTransform: 'capitalize' }}>{credits.tier}</span> plan
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-hint)' }}>Loading…</div>
          )}
        </div>
      </div>

      {/* Checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
        {checkItems.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', flex: 'none',
              background: item.ok ? 'rgba(62,207,142,.15)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${item.ok ? 'rgba(62,207,142,.35)' : 'var(--border)'}`,
              display: 'grid', placeItems: 'center',
            }}>
              <Icon name="check" size={10} stroke={2.5}
                style={{ color: item.ok ? 'var(--success)' : 'var(--text-hint)' }} />
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <button onClick={handleStart} disabled={saving} className="btn btn-primary"
        style={{
          width: '100%', height: 46, fontSize: 15, fontWeight: 700,
          justifyContent: 'center', opacity: saving ? 0.7 : 1,
        }}>
        {saving ? 'Starting…' : 'Start using Click →'}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OnboardingScreen({ user, onComplete }: {
  user: AuthUser;
  onComplete: () => void;
}) {
  const [step,          setStep         ] = useState(1);
  const [screenGranted, setScreenGranted] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [autonomyMode,  setAutonomyMode ] = useState<AutonomyMode>('semi');

  function next() { setStep(s => s + 1); }

  return (
    <div style={{
      width: '100%', height: '100%', background: 'var(--bg-app)',
      fontFamily: 'var(--font)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{
        flex: 'none', padding: '14px 24px 0',
        display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
      }}>
        <ClickMark size={22} radius={7} glow />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Larund Click</span>
      </div>

      {/* Progress */}
      <div style={{ flex: 'none', padding: '0 24px' }}>
        <ProgressBar step={step} />
      </div>

      {/* Scrollable step content */}
      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          {step === 1 && <StepWelcome onNext={next} />}
          {step === 2 && (
            <StepPermissions onNext={next}
              screenGranted={screenGranted} accessGranted={accessGranted}
              setScreenGranted={setScreenGranted} setAccessGranted={setAccessGranted}
            />
          )}
          {step === 3 && <StepAutonomy mode={autonomyMode} setMode={setAutonomyMode} onNext={next} />}
          {step === 4 && <StepHowItWorks onNext={next} />}
          {step === 5 && (
            <StepAllSet
              user={user} mode={autonomyMode}
              screenGranted={screenGranted} accessGranted={accessGranted}
              onComplete={onComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
