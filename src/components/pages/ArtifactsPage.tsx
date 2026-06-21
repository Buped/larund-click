import { useEffect, useMemo, useState } from 'react';
import { ArtifactCard } from '../artifacts/ArtifactCard';
import { ArtifactPreviewRail } from '../artifacts/ArtifactPreviewRail';
import { Icon } from '../icons';
import { listArtifacts } from '../../lib/artifacts/verification';
import { manifestToChatArtifact, type ArtifactPreviewState, type ChatArtifactAttachment } from '../../lib/artifacts/ui';

export function ArtifactsPage() {
  const [items, setItems] = useState<ChatArtifactAttachment[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewState, setPreviewState] = useState<ArtifactPreviewState>({ isOpen: false, mode: 'preview' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const manifests = await listArtifacts();
      setItems(manifests.map(manifestToChatArtifact));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!q) return true;
      return `${item.displayName} ${item.fileName} ${item.kind}`.toLowerCase().includes(q);
    });
  }, [items, kind, query]);

  function preview(artifact: ChatArtifactAttachment) {
    setPreviewState({ ...previewState, isOpen: true, selectedArtifactId: artifact.id, mode: 'preview' });
  }

  return (
    <div style={{ height: '100%', display: 'flex', minWidth: 0, background: 'var(--bg-app)' }}>
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 54, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px' }}>
          <Icon name="fileText" size={16} style={{ color: 'var(--accent)' }} />
          <div style={{ fontSize: 15, fontWeight: 750 }}>Artifacts</div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => void load()}>
            <Icon name="refresh" size={12} /> Refresh
          </button>
        </div>
        <div style={{ padding: 18, display: 'flex', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts..."
            style={{ flex: 1, minWidth: 0, height: 34, borderRadius: 8, border: '1px solid var(--border-md)', background: 'var(--bg-field)', color: 'var(--text-primary)', padding: '0 11px', outline: 'none' }}
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            style={{ height: 34, borderRadius: 8, border: '1px solid var(--border-md)', background: 'var(--bg-field)', color: 'var(--text-primary)', padding: '0 10px' }}
          >
            <option value="all">All types</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="pptx">PPTX</option>
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
          </select>
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, padding: 20, overflow: 'auto' }}>
          {loading && <div style={{ color: 'var(--text-hint)', fontSize: 13 }}>Loading artifacts...</div>}
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ color: 'var(--text-hint)', fontSize: 13 }}>No artifacts yet.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
            {filtered.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                selected={artifact.id === previewState.selectedArtifactId}
                onPreview={preview}
                onChanged={load}
              />
            ))}
          </div>
        </div>
      </main>
      <ArtifactPreviewRail artifacts={items} state={previewState} onStateChange={setPreviewState} onChanged={load} />
    </div>
  );
}
