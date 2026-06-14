import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';
import { pickLocalFile, pickLocalFolder } from '../../lib/references/local-picker';

export function ReferencePicker({ open, onPicked, onClose, triggerRef }: {
  open: boolean;
  onPicked: (refs: DocumentReference[]) => void;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function updatePopoverPosition() {
    if (!triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const viewportPad = 12;
    const width = 230;
    const height = popoverRef.current?.offsetHeight ?? 130;
    
    const topAbove = rect.top - height - gap;
    const topBelow = rect.bottom + gap;
    const top = topAbove >= viewportPad
      ? topAbove
      : Math.min(topBelow, Math.max(viewportPad, window.innerHeight - height - viewportPad));
    
    const maxLeft = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    const left = Math.min(Math.max(rect.left, viewportPad), maxLeft);

    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width,
      zIndex: 1000,
      pointerEvents: 'auto',
    });
  }

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef?.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onReposition = () => updatePopoverPosition();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, onClose, triggerRef]);

  useEffect(() => {
    if (open) updatePopoverPosition();
  }, [open]);

  if (!open) return null;

  async function choose(kind: 'file' | 'folder') {
    const refs = kind === 'file'
      ? await pickLocalFile()
      : await pickLocalFolder();
    if (refs.length) onPicked(refs);
    onClose();
  }

  const item = (icon: string, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 10px',
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: 'var(--text-primary)',
        textAlign: 'left',
        boxShadow: 'none',
        fontSize: 13,
        transition: 'background .1s',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <Icon name={icon} size={14} stroke={1.6} style={{ color: 'var(--text-muted)' }} />
      {label}
    </button>
  );

  const popover = popoverStyle ? createPortal(
    <div
      ref={popoverRef}
      className="popover-in"
      style={{
        position: 'fixed',
        ...popoverStyle,
        padding: 6,
        borderRadius: 9,
        border: '1px solid var(--border-md)',
        background: 'var(--bg-elevated)',
        boxShadow: '0 18px 45px rgba(0,0,0,.45)',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {item('fileText', 'Fájl csatolása…', () => void choose('file'))}
      {item('folder', 'Mappa csatolása…', () => void choose('folder'))}
    </div>,
    document.body,
  ) : null;

  return popover;
}
