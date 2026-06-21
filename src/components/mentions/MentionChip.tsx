import { Icon } from '../icons';
import { MENTION_COLORS, type ReferencedContext } from '../../lib/mentions/types';

export function MentionChip({ refItem, onRemove }: { refItem: ReferencedContext; onRemove?: () => void }) {
  const color = MENTION_COLORS[refItem.kind];
  const doc = refItem.metadata?.documentReference as { kind?: string; path?: string; url?: string } | undefined;
  const kind = doc?.kind ?? refItem.kind;
  const label = `${kind[0].toUpperCase()}${kind.slice(1).replace(/_/g, ' ')}`;
  const target = doc?.path ?? doc?.url;
  const title = [refItem.label, target, refItem.metadata?.status ? String(refItem.metadata.status) : undefined].filter(Boolean).join(' - ');
  return (
    <span
      title={title}
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
