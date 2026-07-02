import { PROJECT_CONTEXT_LIMITS } from '../../lib/project-context/limits';
import type { ProjectSource } from '../../lib/project-context/types';

export function ProjectContextStats({ sources }: { sources: ProjectSource[] }) {
  const ready = sources.filter((source) => source.status === 'ready' && source.isEnabled);
  const totalChars = ready.reduce((sum, source) => sum + source.charCount, 0);
  const chunks = sources.reduce((sum, source) => sum + (source.chunkCount ?? 0), 0);
  const items = [
    [`${sources.length}/${PROJECT_CONTEXT_LIMITS.maxSourcesPerProject}`, 'sources'],
    [`${totalChars.toLocaleString()}/${PROJECT_CONTEXT_LIMITS.maxCharsPerProject.toLocaleString()}`, 'chars'],
    [`${chunks}/${PROJECT_CONTEXT_LIMITS.maxChunksPerProject}`, 'chunks'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {items.map(([value, label]) => (
        <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px', background: 'var(--bg-elevated)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}
