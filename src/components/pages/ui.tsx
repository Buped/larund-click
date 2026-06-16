// Shared UI primitives for the redesigned Larund product pages. These keep the
// page components small and visually consistent. Styling reuses the app CSS
// variables; no mouse/pixel automation lives here — these are pure view helpers.

import React, { useEffect, useState } from 'react';
import { Icon } from '../icons';

export const card: React.CSSProperties = { background: 'rgba(22,22,20,0.72)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: '0 14px 34px rgba(0,0,0,0.18)' };
export const btn: React.CSSProperties = { background: 'var(--accent)', color: '#04122a', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 };
export const ghostBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.045)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 };
export const dangerBtn: React.CSSProperties = { ...ghostBtn, color: 'var(--danger)' };
export const input: React.CSSProperties = { background: 'rgba(10,10,8,0.46)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none', width: '100%' };
export const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em' };

export function statusColor(s: string): string {
  if (/pass|connected|configured|completed|active|approved|enabled|verified|read_only/.test(s)) return 'var(--success)';
  if (/warn|missing|blocked|needs|available|suggested|needs_review|drafting|pending|paused|waiting|untrusted|coming/.test(s)) return 'var(--warning)';
  if (/fail|error|cancelled|rejected|denied|disabled|destructive|credential|critical/.test(s)) return 'var(--danger)';
  return 'var(--text-hint)';
}

/** Standard page header: title, subtitle, optional right-side actions. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div>
        <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--text-primary)', margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '5px 0 0', lineHeight: 1.5 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
    </div>
  );
}

/** Scrollable page frame with a centered max-width column. */
export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="scroll" style={{ flex: 1, minHeight: 0, padding: '26px 30px 40px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export function Empty({ text, icon = 'sparkle' }: { text: string; icon?: string }) {
  return (
    <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-hint)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)' }}>
        <Icon name={icon} size={17} stroke={1.6} />
      </span>
      <span>{text}</span>
    </div>
  );
}

export function Loading() {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-hint)', fontSize: 12.5 }}>Loading…</div>;
}

export function ErrorBox({ text }: { text: string }) {
  return <div style={{ ...card, color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 12.5 }}>Error: {text}</div>;
}

export function Badge({ text, color }: { text: string; color?: string }) {
  const c = color ?? 'var(--text-hint)';
  return <span style={{ fontSize: 10.5, color: c, border: `1px solid ${c}33`, background: `${c}14`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{text}</span>;
}

export function Pills<T extends string>({ value, options, onChange, danger }: { value: T; options: readonly T[]; onChange: (v: T) => void; danger?: boolean }) {
  const accent = danger ? 'var(--danger)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{ ...ghostBtn, ...(value === o ? { background: accent, color: '#04122a', borderColor: accent, fontWeight: 650 } : {}) }}>
          {String(o).replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

/** Segmented tab control. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 10, padding: 3, marginBottom: 16 }}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 12.5, fontFamily: 'inherit', fontWeight: active ? 600 : 450,
            background: active ? 'var(--bg-elevated)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          }}>
            {t.label}
            {t.count != null && t.count > 0 && <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-hint)' }}>
        <Icon name="search" size={14} stroke={1.7} />
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search…'} style={{ ...input, paddingLeft: 32 }} />
    </div>
  );
}

/** Async list loader hook with loading/error states + manual reload. */
export function useAsyncList<T>(loader: () => Promise<T[]>, deps: unknown[]): {
  items: T[]; loading: boolean; error: string | null; reload: () => void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    loader().then(
      (r) => { if (alive) { setItems(r); setLoading(false); } },
      (e) => { if (alive) { setError(String(e)); setLoading(false); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { items, loading, error, reload: () => setTick((t) => t + 1) };
}

/** Active workspace id stored in localStorage; shared across pages. */
export function getActiveWorkspaceId(): string | undefined {
  return localStorage.getItem('active_workspace_id') ?? undefined;
}
