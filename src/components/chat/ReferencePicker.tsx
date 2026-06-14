import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';
import { pickLocalFile, pickLocalFolder, pickUrlReference } from '../../lib/references/local-picker';

export function ReferencePicker({ open, onPicked, onClose }: {
  open: boolean;
  onPicked: (refs: DocumentReference[]) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  async function choose(kind: 'file' | 'folder' | 'url') {
    const refs = kind === 'file'
      ? await pickLocalFile()
      : kind === 'folder'
        ? await pickLocalFolder()
        : await pickUrlReference();
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
      }}
    >
      <Icon name={icon} size={14} stroke={1.6} style={{ color: 'var(--text-muted)' }} />
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: 8,
        bottom: 50,
        width: 230,
        padding: 6,
        borderRadius: 9,
        border: '1px solid var(--border-md)',
        background: 'var(--bg-elevated)',
        boxShadow: '0 18px 45px rgba(0,0,0,.45)',
        zIndex: 20,
      }}
    >
      {item('fileText', 'Select local file...', () => void choose('file'))}
      {item('folder', 'Select local folder...', () => void choose('folder'))}
      {item('link', 'Paste URL...', () => void choose('url'))}
    </div>
  );
}
