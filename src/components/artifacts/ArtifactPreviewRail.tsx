import type { ChatArtifactAttachment } from '../../lib/artifacts/ui';
import type { ArtifactPreviewState } from '../../lib/artifacts/ui';
import { ArtifactPreviewHeader } from './ArtifactPreviewHeader';
import { ArtifactViewer } from './ArtifactViewer';

export function ArtifactPreviewRail({
  artifacts,
  state,
  onStateChange,
  onChanged,
}: {
  artifacts: ChatArtifactAttachment[];
  state: ArtifactPreviewState;
  onStateChange: (state: ArtifactPreviewState) => void;
  onChanged?: () => void;
}) {
  if (!state.isOpen) return null;
  const selected = artifacts.find((artifact) => artifact.id === state.selectedArtifactId) ?? artifacts[0];
  const width = state.widthPx ?? 560;
  return (
    <aside style={{
      width,
      minWidth: 380,
      maxWidth: '52vw',
      height: '100%',
      borderLeft: '1px solid var(--border-md)',
      background: 'var(--bg-panel)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flex: 'none',
    }}>
      <ArtifactPreviewHeader
        artifact={selected}
        onChanged={onChanged}
        onClose={() => onStateChange({ ...state, isOpen: false })}
      />
      {artifacts.length > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => onStateChange({ ...state, selectedArtifactId: artifact.id })}
              style={{
                border: artifact.id === selected?.id ? '1px solid rgba(var(--accent-rgb),.55)' : '1px solid var(--border-md)',
                borderRadius: 999,
                background: artifact.id === selected?.id ? 'rgba(var(--accent-rgb),.12)' : 'rgba(var(--ov-color),.04)',
                color: 'var(--text-muted)',
                fontSize: 11.5,
                padding: '4px 9px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {artifact.kind.toUpperCase()} · {artifact.fileName}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ArtifactViewer artifact={selected} />
      </div>
    </aside>
  );
}
