import { useEffect, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactPreviewBlobUrl, getArtifactText } from '../../../lib/artifacts/actions';
import { PreviewLoading } from './PdfArtifactViewer';

export function PptxArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    let disposed = false;
    setThumb(null);
    setText('');
    getArtifactPreviewBlobUrl(artifact).then((url) => { if (!disposed) setThumb(url); });
    getArtifactText(artifact).then((value) => { if (!disposed) setText(value); }).catch(() => {});
    return () => {
      disposed = true;
      if (thumb) URL.revokeObjectURL(thumb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.artifactId]);

  if (!thumb && !text) return <PreviewLoading label="Preparing presentation preview..." />;
  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#25272d', padding: 20 }}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12 }}>
          <span>{artifact.slideCount ?? 0} slide(s)</span>
          <span>Open in PowerPoint/LibreOffice for full fidelity.</span>
        </div>
        {thumb && (
          <div style={{ maxWidth: 760, margin: '0 auto', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-md)', background: 'rgba(0,0,0,.28)' }}>
            <img src={thumb} alt="" style={{ width: '100%', display: 'block' }} />
          </div>
        )}
        {text && (
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: 12.5, lineHeight: 1.6, background: 'rgba(0,0,0,.24)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
