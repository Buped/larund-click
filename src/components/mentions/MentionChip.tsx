import { Icon } from '../icons';
import { MENTION_COLORS, type ReferencedContext } from '../../lib/mentions/types';

export function MentionChip({ refItem, onRemove }: { refItem: ReferencedContext; onRemove?: () => void }) {
  const color = MENTION_COLORS[refItem.kind];
  const label = `${refItem.kind[0].toUpperCase()}${refItem.kind.slice(1)}`;
  return (
    <span
      title={refItem.metadata?.status ? `${refItem.label} - ${refItem.metadata.status}` : refItem.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        maxWidth: 240,
        height: 24,
        padding: '0 8px',
        borderRadius: 999,
        fontSize: 11.5,
        background: `${color}1f`,
        color,
        border: `1px solid ${color}55`,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      <span style={{ opacity: 0.78, fontWeight: 650 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{refItem.label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Remove"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color, display: 'grid', placeItems: 'center', padding: 0 }}
        >
          <Icon name="x" size={10} stroke={2.4} />
        </button>
      )}
    </span>
  );
}
