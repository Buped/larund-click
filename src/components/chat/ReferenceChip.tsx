import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';

/**
 * Per-kind colour palette so an attached reference reads clearly as a live
 * pointer to a real file/folder, visually distinct from surrounding chips.
 */
function paletteFor(ref: Pick<DocumentReference, 'kind' | 'mimeType'>): { icon: string; fg: string; bg: string; border: string } {
  if (ref.mimeType === 'application/pdf') {
    return { icon: 'fileText', fg: '#EA4335', bg: 'rgba(234,67,53,.13)', border: 'rgba(234,67,53,.42)' };
  }
  if (ref.mimeType?.startsWith('image/')) {
    return { icon: 'image', fg: '#A142F4', bg: 'rgba(161,66,244,.13)', border: 'rgba(161,66,244,.42)' };
  }
  switch (ref.kind) {
    case 'google_drive_folder':
      return { icon: 'folder', fg: '#34A853', bg: 'rgba(52,168,83,.13)', border: 'rgba(52,168,83,.42)' };
    case 'google_doc':
      return { icon: 'fileText', fg: '#4285F4', bg: 'rgba(66,133,244,.13)', border: 'rgba(66,133,244,.42)' };
    case 'google_sheet':
      return { icon: 'fileSpreadsheet', fg: '#34A853', bg: 'rgba(52,168,83,.13)', border: 'rgba(52,168,83,.42)' };
    case 'google_slide':
      return { icon: 'presentation', fg: '#F9AB00', bg: 'rgba(249,171,0,.15)', border: 'rgba(249,171,0,.45)' };
    case 'google_drive_file':
      return { icon: 'externalLink', fg: '#34A853', bg: 'rgba(52,168,83,.13)', border: 'rgba(52,168,83,.42)' };
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
  const palette = paletteFor(refItem);
  return (
    <span
      title={refItem.webViewLink ?? refItem.path ?? refItem.url ?? refItem.label}
      onClick={() => {
        if (!onRemove && refItem.webViewLink) window.open(refItem.webViewLink, '_blank');
      }}
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
        cursor: !onRemove && refItem.webViewLink ? 'pointer' : 'default',
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
