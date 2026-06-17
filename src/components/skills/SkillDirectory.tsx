import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { Empty, SearchInput, btn, ghostBtn, getActiveWorkspaceId, useAsyncList } from '../pages/ui';
import { SkillCard } from './SkillCard';
import { SkillDetailModal } from './SkillDetailModal';
import { NewSkillWizard } from './NewSkillWizard';
import type { SkillPackage } from '../../lib/skills/packages/types';
import { listSkillPackages, setSkillPackageEnabled } from '../../lib/skills/packages/store';

const FILTERS = ['All', 'Built-in', 'Created by you', 'Suggested', 'Documents', 'Development', 'Marketing', 'Data', 'Operations', 'Creative'] as const;
type Filter = typeof FILTERS[number];

export function SkillDirectory({ userId }: { userId: string }) {
  const workspaceId = getActiveWorkspaceId();
  const skills = useAsyncList<SkillPackage>(() => listSkillPackages({ userId, workspaceId, includeSuggested: true }), [userId, workspaceId]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [open, setOpen] = useState<SkillPackage | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.items.filter((skill) => {
      const hay = `${skill.name} ${skill.description} ${skill.categories.join(' ')} ${skill.triggerPhrases.join(' ')}`.toLowerCase();
      const sourceOk =
        filter === 'All'
        || (filter === 'Built-in' && skill.source === 'built_in')
        || (filter === 'Created by you' && (skill.source === 'user' || skill.source === 'workspace'))
        || (filter === 'Suggested' && skill.source === 'suggested')
        || skill.categories.some((c) => c.toLowerCase() === filter.toLowerCase() || (filter === 'Documents' && /doc|file|office|productivity/.test(c.toLowerCase())));
      return sourceOk && (!q || hay.includes(q));
    });
  }, [skills.items, query, filter]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1 }}><SearchInput value={query} onChange={setQuery} placeholder="Search skills..." /></div>
        <button style={{ ...btn, height: 36 }} onClick={() => setCreating(true)}><Icon name="plus" size={13} stroke={2} /> New skill</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {FILTERS.map((f) => <button key={f} style={{ ...ghostBtn, ...(filter === f ? { background: 'var(--accent)', color: '#04122a', borderColor: 'var(--accent)', fontWeight: 650 } : {}) }} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      {filtered.length === 0 && !skills.loading && <Empty text="No skills match this view." icon="sparkle" />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {filtered.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onOpen={() => setOpen(skill)}
            onToggle={(enabled) => setSkillPackageEnabled(skill, enabled, { userId, workspaceId }).then(skills.reload)}
          />
        ))}
      </div>
      {creating && <NewSkillWizard userId={userId} workspaceId={workspaceId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); skills.reload(); }} />}
      {open && <SkillDetailModal skill={open} userId={userId} workspaceId={workspaceId} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); skills.reload(); }} />}
    </>
  );
}
