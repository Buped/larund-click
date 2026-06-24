import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactText } from '../../../lib/artifacts/actions';
import { PreviewError, PreviewLoading } from './PdfArtifactViewer';

interface ColumnProfile {
  name: string;
  type: 'number' | 'date' | 'text' | 'empty';
  non_null: number;
  nulls: number;
  null_ratio: number;
  unique: number | string;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  top_values?: Array<{ value: string; count: number }>;
}

interface SheetProfile {
  sheet?: string;
  row_count: number;
  col_count: number;
  columns: ColumnProfile[];
}

type Tab = 'table' | 'profile';

export function SheetArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [tab, setTab] = useState<Tab>('table');
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>Adat-profil</TabButton>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'table' ? <TablePreview artifact={artifact} /> : <ProfileView artifact={artifact} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        borderRadius: 7, border: '1px solid ' + (active ? 'var(--accent, #EE7E3A)' : 'transparent'),
        background: active ? 'rgba(238,126,58,.12)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  );
}

function TablePreview({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setRows(null);
    setError('');
    getArtifactText(artifact)
      .then((text) => {
        if (disposed) return;
        setRows(text.split(/\r?\n/).slice(0, 50).map((line) => line.split(',')));
      })
      .catch((err) => { if (!disposed) setError(String(err instanceof Error ? err.message : err)); });
    return () => { disposed = true; };
  }, [artifact]);

  if (error) return <PreviewError message={error} />;
  if (!rows) return <PreviewLoading label="Loading table preview..." />;
  return (
    <div style={{ padding: 18 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{ border: '1px solid var(--border)', padding: '7px 9px', color: 'var(--text-muted)' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileView({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [profile, setProfile] = useState<SheetProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setProfile(null);
    setError('');
    if (!artifact.localPath) {
      setError('A profil-nézethez a fájl helyi elérési útja szükséges.');
      return;
    }
    invoke<string>('sheet_profile', { path: artifact.localPath, sheet: null, sampleSize: 8 })
      .then((raw) => { if (!disposed) setProfile(JSON.parse(raw) as SheetProfile); })
      .catch((err) => { if (!disposed) setError(String(err instanceof Error ? err.message : err)); });
    return () => { disposed = true; };
  }, [artifact]);

  if (error) return <PreviewError message={error} />;
  if (!profile) return <PreviewLoading label="Adatprofil számítása..." />;

  return (
    <div style={{ padding: 18 }}>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12 }}>
        {profile.row_count.toLocaleString('hu-HU')} sor · {profile.col_count} oszlop{profile.sheet ? ` · ${profile.sheet}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {profile.columns.map((col) => <ColumnCard key={col.name + col.type} col={col} />)}
      </div>
    </div>
  );
}

const TYPE_COLOR: Record<ColumnProfile['type'], string> = {
  number: '#3FB984',
  date: '#2563EB',
  text: '#EE7E3A',
  empty: '#6B7280',
};

function ColumnCard({ col }: { col: ColumnProfile }) {
  const num = (v: number | undefined) => (v == null ? '—' : v.toLocaleString('hu-HU', { maximumFractionDigits: 2 }));
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'rgba(0,0,0,.14)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: TYPE_COLOR[col.type] }}>{col.type}</span>
      </div>
      <Stat label="Kitöltött" value={`${col.non_null.toLocaleString('hu-HU')} (${Math.round((1 - col.null_ratio) * 100)}%)`} />
      <Stat label="Egyedi" value={String(col.unique)} />
      {col.type === 'number' && (
        <>
          <Stat label="Összeg" value={num(col.sum)} />
          <Stat label="Átlag" value={num(col.mean)} />
          <Stat label="Min / Max" value={`${num(col.min)} / ${num(col.max)}`} />
        </>
      )}
      {col.type === 'text' && col.top_values && col.top_values.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', marginBottom: 3 }}>Leggyakoribb</div>
          {col.top_values.slice(0, 5).map((tv, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{tv.value || '∅'}</span>
              <span>{tv.count.toLocaleString('hu-HU')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
      <span style={{ color: 'var(--text-hint)' }}>{label}</span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
