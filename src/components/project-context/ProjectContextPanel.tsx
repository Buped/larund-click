import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../icons';
import type { Project } from '../../lib/projects/types';
import type { ProjectContext, ProjectSource } from '../../lib/project-context/types';
import {
  getProjectContext,
  listProjectSources,
  upsertProjectContext,
} from '../../lib/project-context/store';
import { ProjectBriefEditor } from './ProjectBriefEditor';
import { ProjectInstructionsEditor } from './ProjectInstructionsEditor';
import { ProjectSourcesList } from './ProjectSourcesList';
import { AddProjectSourceModal } from './AddProjectSourceModal';
import { ProjectContextStats } from './ProjectContextStats';

const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-hint)' };
const card: CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 };

export function ProjectContextPanel({
  project,
  userId,
}: {
  project: Project;
  userId: string;
}) {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ctx, rows] = await Promise.all([
        getProjectContext(project.id),
        listProjectSources(project.id),
      ]);
      setContext(ctx);
      setSources(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { void reload(); }, [reload]);

  async function saveBrief(brief: string) {
    const next = await upsertProjectContext(project.id, { brief });
    setContext(next);
  }

  async function saveInstructions(instructions: string) {
    const next = await upsertProjectContext(project.id, { instructions });
    setContext(next);
  }

  const readySources = sources.filter((source) => source.status === 'ready' && source.isEnabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 12 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(var(--accent-rgb),.12)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Icon name="cpu" size={17} stroke={1.6} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 750, color: 'var(--text-primary)' }}>Project Context</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-hint)', lineHeight: 1.5, marginTop: 4 }}>
            Shared project knowledge for {project.name}. Larund injects a short memory block and retrieves only relevant source chunks.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <span className="pill pill-blue" style={{ fontSize: 10.5 }}>Memory</span>
            <span className="pill" style={{ fontSize: 10.5 }}>{readySources.length} ready sources</span>
            {context?.updatedAt && <span className="pill" style={{ fontSize: 10.5 }}>Updated {new Date(context.updatedAt).toLocaleString()}</span>}
          </div>
        </div>
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>Loading Project Context...</div>}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      <ProjectContextStats sources={sources} />

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={sectionTitle}>Project Brief</div>
        <ProjectBriefEditor value={context?.brief ?? ''} onSave={saveBrief} />
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={sectionTitle}>Instructions</div>
        <ProjectInstructionsEditor value={context?.instructions ?? ''} onSave={saveInstructions} />
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={sectionTitle}>Sources</div>
          <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={13} stroke={1.8} /> Add source
          </button>
        </div>
        <ProjectSourcesList sources={sources} onChanged={reload} />
      </section>

      <section style={{ ...card, display: 'grid', gap: 6 }}>
        <div style={sectionTitle}>AI Summary</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {context?.aiSummary || context?.sourceSummary || 'Extractive project memory will appear here as sources are added. LLM summary generation can be added later.'}
        </div>
      </section>

      {modalOpen && <AddProjectSourceModal projectId={project.id} userId={userId} onClose={() => setModalOpen(false)} onAdded={reload} />}
    </div>
  );
}
