import { useState } from 'react';
import { Icon } from '../icons';
import type { ProjectSource } from '../../lib/project-context/types';
import {
  deleteProjectSource,
  reindexProjectSource,
  setProjectSourceEnabled,
} from '../../lib/project-context/store';
import { ProjectSourceCard } from './ProjectSourceCard';
import { ProjectSourcePreview } from './ProjectSourcePreview';

export function ProjectSourcesList({
  sources,
  onChanged,
}: {
  sources: ProjectSource[];
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectSource | null>(null);
  const [status, setStatus] = useState('');

  async function run(source: ProjectSource, action: () => Promise<void>) {
    setBusy(source.id); setStatus('');
    try {
      await action();
      await onChanged();
      if (preview?.id === source.id) setPreview(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  if (sources.length === 0) {
    return (
      <div style={{ border: '1px dashed var(--border-md)', borderRadius: 8, padding: 18, textAlign: 'center', color: 'var(--text-hint)', fontSize: 12.5 }}>
        <Icon name="fileText" size={20} stroke={1.4} style={{ margin: '0 auto 8px' }} />
        No project sources yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {sources.map((source) => (
        <ProjectSourceCard
          key={source.id}
          source={source}
          busy={busy === source.id}
          onPreview={() => setPreview(source)}
          onToggle={() => void run(source, () => setProjectSourceEnabled(source.id, !source.isEnabled))}
          onReindex={() => void run(source, async () => { await reindexProjectSource(source.id); })}
          onDelete={() => {
            if (window.confirm(`Delete "${source.title}" from Project Context?`)) void run(source, () => deleteProjectSource(source.id));
          }}
        />
      ))}
      {status && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{status}</div>}
      {preview && (
        <ProjectSourcePreview
          source={preview}
          onClose={() => setPreview(null)}
          onReindex={() => void run(preview, async () => { await reindexProjectSource(preview.id); })}
          onDelete={() => {
            if (window.confirm(`Delete "${preview.title}" from Project Context?`)) void run(preview, () => deleteProjectSource(preview.id));
          }}
        />
      )}
    </div>
  );
}
