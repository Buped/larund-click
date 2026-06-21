import { useEffect, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactFileBlobUrl } from '../../../lib/artifacts/actions';

export function PdfArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let disposed = false;
    setUrl(null);
    setError('');
    getArtifactFileBlobUrl(artifact)
      .then((next) => { if (!disposed) setUrl(next); })
      .catch((err) => { if (!disposed) setError(String(err instanceof Error ? err.message : err)); });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.artifactId, artifact.fileId]);

  if (error) return <PreviewError message={error} />;
  if (!url) return <PreviewLoading label="Loading PDF preview..." />;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setZoom((z) => Math.max(60, z - 10))}>-</button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', minWidth: 44, textAlign: 'center' }}>{zoom}%</span>
        <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => setZoom((z) => Math.min(180, z + 10))}>+</button>
        <div style={{ flex: 1 }} />
        {artifact.pageCount ? <span style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{artifact.pageCount} page(s)</span> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#2a2c32', padding: 18 }}>
        <div style={{ width: `${zoom}%`, minWidth: 320, height: '100%', margin: '0 auto', background: '#fff', boxShadow: '0 14px 40px rgba(0,0,0,.35)' }}>
          <iframe title={artifact.displayName} src={url} style={{ width: '100%', height: '100%', minHeight: 720, border: 'none', display: 'block', background: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

export function PreviewLoading({ label }: { label: string }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-hint)', fontSize: 13 }}>{label}</div>;
}

export function PreviewError({ message }: { message: string }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Preview unavailable</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', lineHeight: 1.5 }}>{message}</div>
      </div>
    </div>
  );
}
