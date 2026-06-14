import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';

export function ReferenceChip({ refItem, onRemove }: {
  refItem: DocumentReference;
  onRemove?: () => void;
}) {
  const icon = refItem.kind === 'folder' ? 'folder' : refItem.kind === 'url' ? 'link' : 'fileText';
  return (
    <span
      title={refItem.path ?? refItem.url ?? refItem.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 220,
        height: 26,
        padding: '0 8px',
        borderRadius: 7,
        border: '1px solid rgba(74,158,255,.25)',
        background: 'rgba(74,158,255,.1)',
        color: 'var(--text-primary)',
        fontSize: 12,
      }}
    >
      <Icon name={icon} size={13} stroke={1.7} style={{ color: 'var(--accent)' }} />
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
            color: 'var(--text-hint)',
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
