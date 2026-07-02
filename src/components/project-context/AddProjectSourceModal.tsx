import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../icons';
import { detectLikelySecrets, normalizeProjectSourceText } from '../../lib/project-context/chunk';
import { PROJECT_CONTEXT_ERRORS, PROJECT_CONTEXT_LIMITS } from '../../lib/project-context/limits';
import { createProjectSource } from '../../lib/project-context/store';
import { extensionFromName, readTextFile, validateProjectSourceFile, validateProjectSourceText } from '../../lib/project-context/ingest';

const input: CSSProperties = { width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };

export function AddProjectSourceModal({
  projectId,
  userId,
  onClose,
  onAdded,
}: {
  projectId: string;
  userId: string;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'paste' | 'upload'>('paste');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function addPasted() {
    const normalized = normalizeProjectSourceText(text);
    const validation = validateProjectSourceText(normalized);
    if (!validation.ok) { setStatus(validation.error ?? PROJECT_CONTEXT_ERRORS.textOnly); return; }
    const secrets = detectLikelySecrets(normalized);
    if (secrets.length && !window.confirm('This looks like a secret or credential. Project Context may be visible to project members. Are you sure?')) return;
    setBusy(true); setStatus('');
    try {
      await createProjectSource({
        projectId,
        createdByUserId: userId,
        title: title.trim() || 'Pasted source',
        sourceType: 'pasted_text',
        contentText: normalized,
      });
      await onAdded();
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length > PROJECT_CONTEXT_LIMITS.maxUploadFilesAtOnce) {
      setStatus(`Upload up to ${PROJECT_CONTEXT_LIMITS.maxUploadFilesAtOnce} files at once.`);
      return;
    }
    setBusy(true); setStatus('');
    const failures: string[] = [];
    let successes = 0;
    try {
      for (const file of Array.from(files)) {
        const fileValidation = validateProjectSourceFile(file);
        if (!fileValidation.ok) { failures.push(`${file.name}: ${fileValidation.error}`); continue; }
        try {
          const contentText = await readTextFile(file);
          const secrets = detectLikelySecrets(contentText);
          if (secrets.length && !window.confirm(`${file.name} looks like it may contain a secret or credential. Project Context may be visible to project members. Upload it anyway?`)) continue;
          await createProjectSource({
            projectId,
            createdByUserId: userId,
            title: file.name,
            sourceType: 'upload_text',
            contentText,
            fileName: file.name,
            mimeType: file.type || 'text/plain',
            extension: extensionFromName(file.name),
          });
          successes += 1;
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await onAdded();
      setStatus([successes ? `${successes} source${successes === 1 ? '' : 's'} added.` : '', ...failures].filter(Boolean).join('\n'));
      if (successes && failures.length === 0) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 100, background: 'rgba(0,0,0,.68)', padding: 20 }}>
      <div style={{ width: 520, maxWidth: '96vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 12, padding: 18, boxShadow: '0 30px 90px rgba(0,0,0,.75)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Icon name="plus" size={15} stroke={1.8} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Add project source</div>
          <button className="btn btn-ghost" style={{ width: 28, height: 28, padding: 0 }} onClick={onClose}><Icon name="x" size={13} stroke={1.8} /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['paste', 'upload'] as const).map((m) => (
            <button key={m} className={`btn ${mode === m ? 'btn-primary' : 'btn-ghost'}`} style={{ height: 30, fontSize: 12, flex: 1 }} onClick={() => setMode(m)}>
              <Icon name={m === 'paste' ? 'fileText' : 'upload'} size={13} stroke={1.6} /> {m === 'paste' ? 'Paste text' : 'Upload files'}
            </button>
          ))}
        </div>
        {mode === 'paste' ? (
          <div style={{ display: 'grid', gap: 9 }}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Source title" style={input} />
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} placeholder="Paste text-based project knowledge here..." style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            <button className="btn btn-primary" style={{ height: 32, fontSize: 12.5 }} disabled={!text.trim() || busy} onClick={() => void addPasted()}>{busy ? 'Adding...' : 'Add source'}</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.log,text/*,application/json,application/xml"
              disabled={busy}
              onChange={(event) => void addFiles(event.target.files)}
              style={input}
            />
            <div style={{ fontSize: 12, color: 'var(--text-hint)', lineHeight: 1.5 }}>
              Supported: .txt, .md, .csv, .json, .yaml, .yml, .xml, .html, .log. PDF/DOCX extraction will come later.
            </div>
          </div>
        )}
        {status && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '12px 0 0', fontSize: 11.5, color: status.includes('added') ? 'var(--text-hint)' : 'var(--danger)' }}>{status}</pre>}
      </div>
    </div>
  );
}
