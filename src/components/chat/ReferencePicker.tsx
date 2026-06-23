import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';
import { pickLocalFile, pickLocalFolder } from '../../lib/references/local-picker';
import { googleDriveConnectionState, listDriveFolder, listRecentDriveItems, searchDriveItems, type DriveFileTypeFilter } from '../../lib/references/google-drive';

function driveVisualFor(ref: DocumentReference): { icon: string; color: string; label: string; bg: string } {
  if (ref.kind === 'google_drive_folder') return { icon: 'folder', color: '#e0a84e', bg: 'rgba(224,168,78,.12)', label: 'Google Drive folder' };
  if (ref.kind === 'google_doc') return { icon: 'fileText', color: '#4285F4', bg: 'rgba(66,133,244,.13)', label: 'Google Docs document' };
  if (ref.kind === 'google_sheet') return { icon: 'fileSpreadsheet', color: '#34A853', bg: 'rgba(52,168,83,.13)', label: 'Google Sheets spreadsheet' };
  if (ref.kind === 'google_slide') return { icon: 'presentation', color: '#F9AB00', bg: 'rgba(249,171,0,.15)', label: 'Google Slides presentation' };
  if (ref.mimeType === 'application/pdf') return { icon: 'fileText', color: '#EA4335', bg: 'rgba(234,67,53,.13)', label: 'PDF' };
  if (ref.mimeType?.startsWith('image/')) return { icon: 'image', color: '#A142F4', bg: 'rgba(161,66,244,.13)', label: 'Image' };
  return { icon: 'externalLink', color: '#34A853', bg: 'rgba(52,168,83,.13)', label: 'Drive file' };
}

export function ReferencePicker({ open, onPicked, onClose, triggerRef, userId }: {
  open: boolean;
  onPicked: (refs: DocumentReference[]) => void;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  userId: string;
}) {
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  function updatePopoverPosition() {
    if (!triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const viewportPad = 12;
    const width = 240;
    const height = popoverRef.current?.offsetHeight ?? 168;
    const topAbove = rect.top - height - gap;
    const topBelow = rect.bottom + gap;
    const top = topAbove >= viewportPad
      ? topAbove
      : Math.min(topBelow, Math.max(viewportPad, window.innerHeight - height - viewportPad));
    const maxLeft = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    const left = Math.min(Math.max(rect.left, viewportPad), maxLeft);
    setPopoverStyle({ position: 'fixed', top, left, width, zIndex: 1000, pointerEvents: 'auto' });
  }

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef?.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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

  async function choose(kind: 'file' | 'folder') {
    const refs = kind === 'file' ? await pickLocalFile() : await pickLocalFolder();
    if (refs.length) onPicked(refs);
    onClose();
  }

  function chooseDrive() {
    setDriveOpen(true);
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
      onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={14} stroke={1.6} style={{ color: 'var(--text-muted)' }} />
      {label}
    </button>
  );

  const popover = open && popoverStyle ? createPortal(
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
      onPointerDown={(event) => event.stopPropagation()}
    >
      {item('fileText', 'File from computer...', () => void choose('file'))}
      {item('folder', 'Folder from computer...', () => void choose('folder'))}
      {item('externalLink', 'From Google Drive...', chooseDrive)}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {popover}
      <DrivePickerModal
        open={driveOpen}
        userId={userId}
        onPicked={(refs) => {
          onPicked(refs);
          setDriveOpen(false);
        }}
        onClose={() => setDriveOpen(false)}
      />
    </>
  );
}

function DrivePickerModal({ open, userId, onPicked, onClose }: {
  open: boolean;
  userId: string;
  onPicked: (refs: DocumentReference[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DocumentReference[]>([]);
  const [selected, setSelected] = useState<Record<string, DocumentReference>>({});
  const [query, setQuery] = useState('');
  const [type, setType] = useState<DriveFileTypeFilter>('all');
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'Drive' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRecent(nextType: DriveFileTypeFilter = type) {
    setLoading(true);
    setError(null);
    try {
      const state = await googleDriveConnectionState(userId);
      if (!state.ok) {
        setItems([]);
        setError(state.message ?? 'Google Workspace is not connected.');
        return;
      }
      setFolderStack([{ id: 'root', name: 'Drive' }]);
      setItems(await listRecentDriveItems(userId, nextType));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadFolder(id: string, name: string, stackPrefix?: Array<{ id: string; name: string }>, nextType: DriveFileTypeFilter = type) {
    setLoading(true);
    setError(null);
    try {
      setItems(await listDriveFolder(userId, id, nextType));
      const prefix = stackPrefix ?? folderStack;
      setFolderStack([...prefix, { id, name }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(nextType: DriveFileTypeFilter = type) {
    setLoading(true);
    setError(null);
    try {
      setFolderStack([{ id: 'root', name: query.trim() ? 'Search results' : 'Drive' }]);
      setItems(await searchDriveItems(userId, query, nextType));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function applyType(nextType: DriveFileTypeFilter) {
    setType(nextType);
    const current = folderStack[folderStack.length - 1];
    if (query.trim()) {
      void runSearch(nextType);
    } else if (current && current.id !== 'root') {
      void loadFolder(current.id, current.name, folderStack.slice(0, -1), nextType);
    } else {
      void loadRecent(nextType);
    }
  }

  useEffect(() => {
    if (!open) return;
    setSelected({});
    setQuery('');
    setType('all');
    void loadRecent('all');
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const picked = Object.values(selected);
  const fieldStyle: React.CSSProperties = {
    height: 32,
    borderRadius: 7,
    border: '1px solid var(--border-md)',
    background: 'var(--bg-field)',
    color: 'var(--text-primary)',
    padding: '0 10px',
    fontSize: 12.5,
    outline: 'none',
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'var(--scrim)',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
      }}
      onPointerDown={onClose}
    >
      <div
        className="modal-pop"
        style={{
          width: 'min(760px, 100%)',
          maxHeight: 'min(680px, calc(100vh - 36px))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          border: '1px solid var(--border-md)',
          background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-modal)',
          overflow: 'hidden',
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(52,168,83,.13)', color: '#34A853' }}>
            <Icon name="externalLink" size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' }}>Google Drive</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Choose files or folders as AI-readable references</div>
          </div>
          <button className="toolbar-btn" onClick={onClose} title="Close" style={{ marginLeft: 'auto' }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 136px auto', gap: 8, padding: 12, borderBottom: '1px solid var(--border)' }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }}
            placeholder="Search name and content"
            style={fieldStyle}
          />
          <select value={type} onChange={(event) => applyType(event.target.value as DriveFileTypeFilter)} style={fieldStyle}>
            <option value="all">All</option>
            <option value="docs">Docs</option>
            <option value="sheets">Sheets</option>
            <option value="slides">Slides</option>
            <option value="pdf">PDF</option>
            <option value="image">Image</option>
          </select>
          <button className="btn btn-ghost" onClick={() => void runSearch()} style={{ height: 32 }}>
            <Icon name="search" size={13} /> Search
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderBottom: '1px solid var(--border)', minHeight: 38 }}>
          {folderStack.map((part, index) => (
            <button
              key={`${part.id}-${index}`}
              onClick={() => {
                if (index === 0) void loadRecent(type);
                else void loadFolder(part.id, part.name, folderStack.slice(0, index), type);
              }}
              style={{ color: index === folderStack.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, padding: '3px 6px', borderRadius: 6 }}
            >
              {part.name}
            </button>
          ))}
          <button onClick={() => void loadRecent(type)} style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12, padding: '3px 6px', borderRadius: 6 }}>
            Recent
          </button>
        </div>

        <div className="scroll" style={{ minHeight: 260, maxHeight: 430, padding: 8 }}>
          {loading && <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: 13 }}>Loading Drive...</div>}
          {!loading && error && (
            <div style={{ margin: 8, padding: 14, borderRadius: 8, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5 }}>
              {error}
              <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>Next step: open Connections and reconnect Google Workspace.</div>
            </div>
          )}
          {!loading && !error && items.length === 0 && <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: 13 }}>No results.</div>}
          {!loading && !error && items.map((item) => {
            const isFolder = item.kind === 'google_drive_folder';
            const checked = Boolean(selected[item.id]);
            const visual = driveVisualFor(item);
            return (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '28px 28px 1fr auto', alignItems: 'center', gap: 8, minHeight: 42, padding: '5px 7px', borderRadius: 8, background: checked ? 'rgba(52,168,83,.10)' : 'transparent' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setSelected((prev) => {
                    const next = { ...prev };
                    if (next[item.id]) delete next[item.id];
                    else next[item.id] = item;
                    return next;
                  })}
                  style={{ width: 15, height: 15 }}
                />
                <span title={visual.label} style={{ width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', color: visual.color, background: visual.bg }}>
                  <Icon name={visual.icon} size={15} stroke={1.8} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                  <div style={{ color: 'var(--text-hint)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {visual.label}{item.mimeType ? ` - ${item.mimeType}` : ''}{item.lastModified ? ` - ${new Date(item.lastModified).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {isFolder ? (
                  <button className="btn btn-ghost" onClick={() => void loadFolder(item.driveFileId ?? item.id.replace(/^drive-/, ''), item.label, undefined, type)} style={{ height: 28, fontSize: 11.5 }}>
                    Open
                  </button>
                ) : item.webViewLink ? (
                  <button className="toolbar-btn" onClick={() => window.open(item.webViewLink, '_blank')} title="Open in Drive">
                    <Icon name="externalLink" size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{picked.length} selected</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Cancel</button>
          <button className="btn btn-primary" disabled={picked.length === 0} onClick={() => onPicked(picked)}>Insert references</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
