import { useEffect, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactText } from '../../../lib/artifacts/actions';
import { PreviewError, PreviewLoading } from './PdfArtifactViewer';

export function DocxArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setText('');
    setError('');
    getArtifactText(artifact)
      .then((value) => { if (!disposed) setText(value); })
      .catch((err) => { if (!disposed) setError(String(err instanceof Error ? err.message : err)); });
    return () => { disposed = true; };
  }, [artifact]);

  if (error) return <PreviewError message={error} />;
  if (!text) return <PreviewLoading label="Extracting document preview..." />;
  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#303238', padding: 24 }}>
      <div style={{ maxWidth: 780, margin: '0 auto', background: '#f8fafc', color: '#111827', borderRadius: 4, padding: 38, lineHeight: 1.65, boxShadow: '0 18px 50px rgba(0,0,0,.32)' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#64748b', marginBottom: 18 }}>
          Preview generated from extracted text. Open in Word/LibreOffice for full fidelity.
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 13, margin: 0 }}>{text}</pre>
      </div>
    </div>
  );
}
