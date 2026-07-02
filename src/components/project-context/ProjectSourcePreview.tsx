import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import type { ProjectSource, ProjectSourceChunk } from '../../lib/project-context/types';
import { listChunksForSource } from '../../lib/project-context/store';

export function ProjectSourcePreview({ source, onClose, onDelete, onReindex }: {
  source: ProjectSource;
  onClose: () => void;
  onDelete: () => void;
  onReindex: () => void;
}) {
  const [chunks, setChunks] = useState<ProjectSourceChunk[]>([]);
  useEffect(() => {
    let alive = true;
    listChunksForSource(source.id).then((rows) => { if (alive) setChunks(rows); }).catch(() => { if (alive) setChunks([]); });
    return () => { alive = false; };
  }, [source.id]);

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.68)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: 'min(820px, 96vw)', maxHeight: '88vh', overflow: 'hidden', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 12, boxShadow: '0 30px 90px rgba(0,0,0,.75)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="fileText" size={16} stroke={1.6} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>{source.charCount.toLocaleString()} chars · {chunks.length} chunks · {source.sourceType}</div>
          </div>
          <button className="btn btn-ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={onClose}><Icon name="x" size={14} stroke={1.8} /></button>
        </div>
        <div className="scroll" style={{ padding: 18, overflow: 'auto', display: 'grid', gap: 14 }}>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Extractive summary</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{source.summary || 'No summary yet.'}</div>
          </section>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Text preview</div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              {source.contentText.slice(0, 12000)}{source.contentText.length > 12000 ? '\n[truncated]' : ''}
            </pre>
          </section>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Chunks</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {chunks.slice(0, 8).map((chunk) => (
                <div key={chunk.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg-surface)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-hint)', marginBottom: 5 }}>Chunk {chunk.chunkIndex + 1}{chunk.heading ? ` · ${chunk.heading}` : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{chunk.content.slice(0, 420)}{chunk.content.length > 420 ? '...' : ''}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={onReindex}><Icon name="refresh" size={13} stroke={1.6} /> Re-index</button>
          <button className="btn btn-danger" style={{ height: 30, fontSize: 12 }} onClick={onDelete}><Icon name="trash" size={13} stroke={1.6} /> Delete</button>
        </div>
      </div>
    </div>
  );
}
