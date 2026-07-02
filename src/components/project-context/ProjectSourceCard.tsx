import { Icon } from '../icons';
import type { ProjectSource } from '../../lib/project-context/types';

export function ProjectSourceCard({
  source,
  busy,
  onPreview,
  onToggle,
  onReindex,
  onDelete,
}: {
  source: ProjectSource;
  busy?: boolean;
  onPreview: () => void;
  onToggle: () => void;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const statusColor = source.status === 'ready' ? 'var(--success)' : source.status === 'failed' ? 'var(--danger)' : source.status === 'disabled' ? 'var(--text-hint)' : 'var(--warning)';
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(var(--ov-color),.06)', display: 'grid', placeItems: 'center', color: 'var(--text-hint)', flex: 'none' }}>
        <Icon name="fileText" size={15} stroke={1.5} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.title}</div>
          <span style={{ flex: 'none', fontSize: 10.5, color: statusColor, textTransform: 'uppercase', fontWeight: 700 }}>{source.status}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 3 }}>
          {source.sourceType === 'upload_text' ? source.fileName ?? 'uploaded text' : 'pasted text'} · {source.charCount.toLocaleString()} chars · {source.chunkCount ?? 0} chunks
        </div>
        {source.summary && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.45 }}>{source.summary.slice(0, 180)}{source.summary.length > 180 ? '...' : ''}</div>}
        <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>
          Indexed {source.lastIndexedAt ? new Date(source.lastIndexedAt).toLocaleString() : 'never'}{source.lastUsedAt ? ` · used ${new Date(source.lastUsedAt).toLocaleString()}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
        <button className="btn btn-ghost" style={{ width: 28, height: 28, padding: 0 }} title="Preview" disabled={busy} onClick={onPreview}><Icon name="eye" size={13} stroke={1.6} /></button>
        <button className="btn btn-ghost" style={{ width: 28, height: 28, padding: 0 }} title={source.isEnabled ? 'Disable' : 'Enable'} disabled={busy} onClick={onToggle}><Icon name={source.isEnabled ? 'square' : 'play'} size={13} stroke={1.6} /></button>
        <button className="btn btn-ghost" style={{ width: 28, height: 28, padding: 0 }} title="Re-index" disabled={busy} onClick={onReindex}><Icon name="refresh" size={13} stroke={1.6} /></button>
        <button className="btn btn-ghost" style={{ width: 28, height: 28, padding: 0, color: 'var(--danger)' }} title="Delete" disabled={busy} onClick={onDelete}><Icon name="trash" size={13} stroke={1.6} /></button>
      </div>
    </div>
  );
}
