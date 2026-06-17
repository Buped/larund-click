import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MENTION_COLORS, MENTION_TABS, resourceToReference, type MentionKind, type MentionResource, type ReferencedContext } from '../../lib/mentions/types';

export function MentionDropdown({
  open,
  anchorRect,
  resources,
  query,
  kinds,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  resources: MentionResource[];
  query: string;
  kinds?: MentionKind[];
  onPick: (ref: ReferencedContext) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources
      .filter((r) => !kinds || kinds.includes(r.kind))
      .filter((r) => !q || `${r.label} ${r.detail ?? ''} ${r.kind}`.toLowerCase().includes(q));
  }, [resources, query, kinds]);

  useEffect(() => setActive(0), [query, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); onPick(resourceToReference(filtered[active])); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, filtered, active, onPick, onClose]);

  if (!open || !anchorRect) return null;

  const viewportPad = 12;
  const width = Math.min(420, window.innerWidth - viewportPad * 2);
  const height = Math.min(420, Math.max(220, panelRef.current?.offsetHeight ?? 320));
  const below = anchorRect.bottom + 8;
  const above = anchorRect.top - height - 8;
  const top = below + height <= window.innerHeight - viewportPad ? below : Math.max(viewportPad, above);
  const left = Math.min(Math.max(anchorRect.left, viewportPad), Math.max(viewportPad, window.innerWidth - width - viewportPad));

  const byKind = MENTION_TABS
    .filter((t) => !kinds || kinds.includes(t.kind))
    .map((t) => ({ ...t, items: filtered.filter((r) => r.kind === t.kind) }))
    .filter((g) => g.items.length > 0);

  let runningIndex = -1;
  const dropdown = (
    <div
      ref={panelRef}
      className="popover-in"
      style={{
        position: 'fixed',
        top,
        left,
        width,
        maxHeight: Math.min(420, window.innerHeight - viewportPad * 2),
        zIndex: 2000,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-md)',
        borderRadius: 12,
        boxShadow: '0 24px 70px rgba(0,0,0,.62)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text-hint)' }}>
        {query ? `Search: ${query}` : 'Mention a skill, connection, MCP server, memory, workflow, file or folder'}
      </div>
      <div className="scroll" style={{ maxHeight: 360, overflow: 'auto', padding: 6 }}>
        {byKind.length === 0 && <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: 'var(--text-hint)' }}>No matching references.</div>}
        {byKind.map((group) => (
          <div key={group.kind} style={{ marginBottom: 4 }}>
            <div style={{ padding: '7px 8px 4px', fontSize: 10.5, color: MENTION_COLORS[group.kind], textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{group.label}</div>
            {group.items.map((r) => {
              runningIndex += 1;
              const isActive = runningIndex === active;
              return (
                <button
                  key={`${r.kind}:${r.refId}`}
                  onClick={() => onPick(resourceToReference(r))}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 9px',
                    borderRadius: 8,
                    border: 'none',
                    background: isActive ? 'var(--bg-hover)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: MENTION_COLORS[r.kind], flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    {r.detail && <span style={{ display: 'block', marginTop: 1, fontSize: 10.5, color: 'var(--text-hint)' }}>{r.detail}</span>}
                  </span>
                  {!r.available && <span style={{ fontSize: 10.5, color: 'var(--warning)' }}>Needs setup</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  return createPortal(dropdown, document.body);
}
