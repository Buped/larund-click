import { useEffect, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactText } from '../../../lib/artifacts/actions';
import { PreviewError, PreviewLoading } from './PdfArtifactViewer';

export function SheetArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
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
    <div style={{ height: '100%', overflow: 'auto', padding: 18 }}>
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
