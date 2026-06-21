import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import type { ChatArtifactAttachment } from '../../lib/artifacts/ui';
import { formatArtifactCount, formatBytes } from '../../lib/artifacts/ui';
import { copyArtifactPath, getArtifactPreviewBlobUrl, openArtifact, saveArtifactCopy, showArtifactInFolder } from '../../lib/artifacts/actions';

interface ArtifactCardProps {
  artifact: ChatArtifactAttachment;
  selected?: boolean;
  onPreview?: (artifact: ChatArtifactAttachment) => void;
  onChanged?: () => void;
}

function typeColor(kind: string): string {
  if (kind === 'pdf') return '#F9734E';
  if (kind === 'pptx') return '#F59E0B';
  if (kind === 'docx') return '#4A9EFF';
  if (kind === 'xlsx' || kind === 'csv') return '#45C483';
  return 'var(--accent)';
}

export function ArtifactCard({ artifact, selected, onPreview, onChanged }: ArtifactCardProps) {
  const [details, setDetails] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let disposed = false;
    setThumb(null);
    getArtifactPreviewBlobUrl(artifact).then((url) => {
      if (!disposed) setThumb(url);
    });
    return () => {
      disposed = true;
      if (thumb) URL.revokeObjectURL(thumb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.artifactId, artifact.previewFileId]);

  const verified = artifact.verification?.exists && artifact.verification?.readable && artifact.status === 'ready';
  const disabled = artifact.status === 'failed' || artifact.verification?.exists === false;
  const meta = [artifact.kind.toUpperCase(), formatArtifactCount(artifact), formatBytes(artifact.sizeBytes)].filter(Boolean).join(' · ');

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMessage('');
    try {
      const result = await fn();
      if (typeof result === 'string' && result) setMessage(result);
      onChanged?.();
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${selected ? 'rgba(74,158,255,.55)' : 'var(--border-md)'}`,
        borderRadius: 10,
        background: 'linear-gradient(180deg, rgba(var(--ov-color),0.075), rgba(var(--ov-color),0.035))',
        padding: 12,
        display: 'grid',
        gap: 10,
        boxShadow: selected ? '0 0 0 1px rgba(74,158,255,.18), 0 16px 40px rgba(0,0,0,.25)' : 'none',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0,1fr)', gap: 12 }}>
        <button
          onClick={() => onPreview?.(artifact)}
          title="Open preview"
          style={{
            width: 76, height: 96, borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--border-md)', background: 'rgba(0,0,0,.28)',
            display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
          }}
        >
          {thumb ? (
            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Icon name="fileText" size={24} stroke={1.7} style={{ color: typeColor(artifact.kind) }} />
          )}
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 7, flex: 'none',
              display: 'grid', placeItems: 'center',
              background: `${typeColor(artifact.kind)}22`,
              color: typeColor(artifact.kind),
            }}>
              <Icon name="fileText" size={15} stroke={1.8} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {artifact.displayName}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {artifact.fileName}
              </div>
            </div>
            <span style={{
              fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em',
              color: typeColor(artifact.kind), border: `1px solid ${typeColor(artifact.kind)}55`,
              borderRadius: 999, padding: '2px 7px',
            }}>
              {artifact.kind.toUpperCase()}
            </span>
          </div>

          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-hint)' }}>{meta}</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
            {artifact.verification?.exists && <Chip tone="ok">exists</Chip>}
            {artifact.verification?.readable && <Chip tone="ok">readable</Chip>}
            {verified && <Chip tone="ok">verified</Chip>}
            {(artifact.pageCount || artifact.slideCount) && <Chip>{formatArtifactCount(artifact)}</Chip>}
            {artifact.status !== 'ready' && <Chip tone="warn">{artifact.status}</Chip>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
            <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} onClick={() => onPreview?.(artifact)}>
              <Icon name="eye" size={13} stroke={1.7} /> Preview
            </button>
            <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} disabled={disabled || busy === 'open'} onClick={() => void run('open', () => openArtifact(artifact))}>
              <Icon name="externalLink" size={12} /> Open
            </button>
            <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} disabled={disabled || busy === 'save'} onClick={() => void run('save', () => saveArtifactCopy(artifact))}>
              <Icon name="upload" size={12} /> Save copy
            </button>
            <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} disabled={disabled || busy === 'folder'} onClick={() => void run('folder', () => showArtifactInFolder(artifact))}>
              <Icon name="folder" size={12} /> Show
            </button>
            <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => setDetails((v) => !v)}>
              <Icon name="more" size={12} /> Details
            </button>
          </div>
        </div>
      </div>

      {details && (
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 9,
          fontSize: 11,
          color: 'var(--text-hint)',
          display: 'grid',
          gap: 5,
        }}>
          <div><strong style={{ color: 'var(--text-muted)' }}>Artifact ID:</strong> {artifact.artifactId}</div>
          <div><strong style={{ color: 'var(--text-muted)' }}>Created:</strong> {new Date(artifact.createdAt).toLocaleString()}</div>
          {artifact.localPath && <div style={{ wordBreak: 'break-all' }}><strong style={{ color: 'var(--text-muted)' }}>Path:</strong> {artifact.localPath}</div>}
          <div><strong style={{ color: 'var(--text-muted)' }}>Verification:</strong> {artifact.verification?.errors?.length ? artifact.verification.errors.join(', ') : 'ok'}</div>
          <button className="btn btn-ghost" style={{ justifySelf: 'start', height: 28, fontSize: 11.5 }} onClick={() => void run('copy-path', () => copyArtifactPath(artifact))}>
            <Icon name="copy" size={12} /> Copy path
          </button>
        </div>
      )}
      {message && (
        <div style={{ fontSize: 11, color: message.startsWith('blocked') || message.includes('failed') ? 'var(--danger)' : 'var(--text-hint)', wordBreak: 'break-word' }}>
          {message}
        </div>
      )}
    </div>
  );
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'neutral' }) {
  const color = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--danger)' : 'var(--text-muted)';
  return (
    <span style={{
      fontSize: 10.5,
      color,
      border: `1px solid ${tone === 'ok' ? 'rgba(79,209,128,.3)' : tone === 'warn' ? 'rgba(229,72,77,.32)' : 'var(--border-md)'}`,
      borderRadius: 999,
      padding: '2px 7px',
      background: 'rgba(var(--ov-color),0.035)',
    }}>
      {children}
    </span>
  );
}
