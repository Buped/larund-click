import { Icon } from '../icons';
import type { ChatArtifactAttachment } from '../../lib/artifacts/ui';
import { formatArtifactCount } from '../../lib/artifacts/ui';
import { openArtifact, saveArtifactCopy, showArtifactInFolder } from '../../lib/artifacts/actions';

export function ArtifactPreviewHeader({
  artifact,
  onClose,
  onChanged,
}: {
  artifact?: ChatArtifactAttachment;
  onClose: () => void;
  onChanged?: () => void;
}) {
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      console.warn('Artifact action failed:', err);
    }
  }

  return (
    <div style={{
      height: 54,
      borderBottom: '1px solid var(--border-md)',
      background: 'rgba(0,0,0,.22)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 12px',
      flex: 'none',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
        background: 'rgba(74,158,255,.13)', color: 'var(--accent)', flex: 'none',
      }}>
        <Icon name="fileText" size={15} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {artifact?.displayName ?? 'Artifact preview'}
        </div>
        {artifact && (
          <div style={{ fontSize: 10.8, color: 'var(--text-hint)' }}>
            {artifact.kind.toUpperCase()} · {formatArtifactCount(artifact)}
          </div>
        )}
      </div>
      {artifact && (
        <>
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => void run(() => openArtifact(artifact))}>
            <Icon name="externalLink" size={12} /> Open
          </button>
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => void run(() => saveArtifactCopy(artifact))}>
            <Icon name="upload" size={12} /> Save
          </button>
          <button className="btn btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={() => void run(() => showArtifactInFolder(artifact))}>
            <Icon name="folder" size={12} />
          </button>
        </>
      )}
      <button className="btn btn-ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={onClose} title="Close preview">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
