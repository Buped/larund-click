import { ghostBtn } from '../pages/ui';
import type { ConnectionFilter } from './connection-ui-types';

export function ConnectionFilters({
  filters,
  value,
  onChange,
  showUpcomingToggle,
  showUpcoming,
  onToggleUpcoming,
}: {
  filters: readonly ConnectionFilter[];
  value: ConnectionFilter;
  onChange: (filter: ConnectionFilter) => void;
  showUpcomingToggle?: boolean;
  showUpcoming?: boolean;
  onToggleUpcoming?: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
      {filters.map((filter) => (
        <button
          key={filter}
          onClick={() => onChange(filter)}
          style={{
            ...ghostBtn,
            ...(value === filter ? { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 650 } : {}),
          }}
        >
          {filter}
        </button>
      ))}
      {showUpcomingToggle && (
        <>
          <div style={{ flex: 1 }} />
          <button
            onClick={onToggleUpcoming}
            style={{ ...ghostBtn, ...(showUpcoming ? { color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),.4)' } : {}) }}
          >
            {showUpcoming ? 'Hide upcoming' : 'Show upcoming'}
          </button>
        </>
      )}
    </div>
  );
}
