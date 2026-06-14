import { Icon } from '../icons';
import type { DocumentReference, DocumentReferenceKind } from '../../lib/references/types';

/**
 * Per-kind colour palette so an attached reference reads clearly as a live
 * pointer to a real file/folder, visually distinct from surrounding chips.
 */
function paletteFor(kind: DocumentReferenceKind): { icon: string; fg: string; bg: string; border: string } {
  switch (kind) {
    case 'folder':
      // amber — folders
      return { icon: 'folder', fg: '#e0a84e', bg: 'rgba(224,168,78,.13)', border: 'rgba(224,168,78,.4)' };
    case 'url':
      // violet — urls
      return { icon: 'link', fg: '#b48cff', bg: 'rgba(180,140,255,.13)', border: 'rgba(180,140,255,.4)' };
    default:
      // blue/accent — files
      return { icon: 'fileText', fg: 'var(--accent)', bg: 'rgba(74,158,255,.13)', border: 'rgba(74,158,255,.4)' };
  }
}

export function ReferenceChip({ refItem, onRemove }: {
  refItem: DocumentReference;
  onRemove?: () => void;
}) {
  const palette = paletteFor(refItem.kind);
  return (
    <span
      title={refItem.path ?? refItem.url ?? refItem.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 220,
        height: 26,
        padding: '0 9px',
        borderRadius: 7,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <Icon name={palette.icon} size={13} stroke={1.8} style={{ color: palette.fg }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{refItem.label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Remove reference"
          style={{
            width: 16,
            height: 16,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: palette.fg,
            opacity: 0.7,
            display: 'grid',
            placeItems: 'center',
            boxShadow: 'none',
          }}
        >
          <Icon name="x" size={10} stroke={2} />
        </button>
      )}
    </span>
  );
}
