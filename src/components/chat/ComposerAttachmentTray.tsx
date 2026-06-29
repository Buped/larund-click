import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import type { DocumentReference } from '../../lib/references/types';
import { readImageAsDataUrl } from '../../lib/document-reader/readers';

interface ComposerAttachmentTrayProps {
  references: DocumentReference[];
  onRemove: (id: string) => void;
}

export function ComposerAttachmentTray({ references, onRemove }: ComposerAttachmentTrayProps) {
  if (references.length === 0) return null;
  return (
    <div className="composer-attachment-tray" aria-label="Attached files">
      {references.map((ref) => (
        <ComposerAttachmentCard key={ref.id} refItem={ref} onRemove={() => onRemove(ref.id)} />
      ))}
    </div>
  );
}

function ComposerAttachmentCard({ refItem, onRemove }: { refItem: DocumentReference; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [failedPreview, setFailedPreview] = useState(false);
  const isImage = isImageReference(refItem);
  const type = useMemo(() => attachmentType(refItem), [refItem]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailedPreview(false);
    if (!isImage || !refItem.path) return;
    readImageAsDataUrl(refItem.path, 2 * 1024 * 1024)
      .then((url) => {
        if (!cancelled) setPreview(url);
      })
      .catch(() => {
        if (!cancelled) setFailedPreview(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isImage, refItem.path]);

  return (
    <div className={`composer-attachment-card${isImage ? ' composer-attachment-card--image' : ''}`} title={refItem.path ?? refItem.url ?? refItem.label}>
      <button className="composer-attachment-remove" onClick={onRemove} title="Remove attachment" type="button">
        <Icon name="x" size={10} stroke={2.4} />
      </button>

      {isImage ? (
        <div className="composer-attachment-thumb">
          {preview ? (
            <img src={preview} alt={refItem.label} />
          ) : (
            <Icon name={failedPreview ? 'image' : 'camera'} size={24} stroke={1.7} />
          )}
        </div>
      ) : (
        <div className="composer-attachment-fileicon" data-kind={type.kind}>
          <Icon name={type.icon} size={22} stroke={1.7} />
        </div>
      )}

      <div className="composer-attachment-meta">
        <div className="composer-attachment-name">{refItem.label}</div>
        <span className="composer-attachment-badge">{type.label}</span>
      </div>
    </div>
  );
}

function isImageReference(ref: DocumentReference): boolean {
  return Boolean(ref.mimeType?.startsWith('image/')) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(ref.path ?? ref.label);
}

function attachmentType(ref: DocumentReference): { label: string; icon: string; kind: string } {
  if (ref.kind === 'folder' || ref.kind === 'google_drive_folder') return { label: 'FOLDER', icon: 'folder', kind: 'folder' };
  if (ref.kind === 'google_sheet') return { label: 'SHEET', icon: 'fileSpreadsheet', kind: 'sheet' };
  if (ref.kind === 'google_doc') return { label: 'DOC', icon: 'fileText', kind: 'doc' };
  if (ref.kind === 'google_slide') return { label: 'DECK', icon: 'presentation', kind: 'deck' };
  if (ref.kind === 'google_drive_file') return { label: 'DRIVE', icon: 'externalLink', kind: 'file' };
  const name = ref.path ?? ref.label;
  const ext = extensionOf(name);
  if (ref.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return { label: extLabel(ext, 'IMAGE'), icon: 'image', kind: 'image' };
  if (['xlsx', 'xls', 'ods', 'csv'].includes(ext)) return { label: extLabel(ext, 'SHEET'), icon: 'fileSpreadsheet', kind: 'sheet' };
  if (ext === 'pdf') return { label: 'PDF', icon: 'fileText', kind: 'pdf' };
  if (['doc', 'docx', 'md', 'txt'].includes(ext)) return { label: extLabel(ext, 'DOC'), icon: 'fileText', kind: 'doc' };
  if (['ppt', 'pptx'].includes(ext)) return { label: extLabel(ext, 'DECK'), icon: 'presentation', kind: 'deck' };
  if (ref.kind === 'url') return { label: 'URL', icon: 'link', kind: 'url' };
  return { label: extLabel(ext, 'FILE'), icon: 'fileText', kind: 'file' };
}

function extensionOf(nameOrPath: string): string {
  const name = nameOrPath.split(/[\\/]/).pop() ?? nameOrPath;
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toUpperCase().toLowerCase() : '';
}

function extLabel(ext: string, fallback: string): string {
  return ext ? ext.toUpperCase() : fallback;
}
