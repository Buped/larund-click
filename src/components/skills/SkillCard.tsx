import { Badge, card, statusColor } from '../pages/ui';
import type { SkillPackage } from '../../lib/skills/packages/types';

function sourceLabel(source: SkillPackage['source']): string {
  return source === 'built_in' ? 'Built-in' : source === 'user' ? 'Created by you' : source[0].toUpperCase() + source.slice(1);
}

export function SkillCard({ skill, onOpen, onToggle }: {
  skill: SkillPackage;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <button
      onClick={onOpen}
      style={{
        ...card,
        margin: 0,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 180,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill.name}</div>
          <div style={{ fontSize: 12.2, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 4 }}>{skill.description}</div>
        </div>
        <label onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-hint)', flex: 'none' }}>
          <input type="checkbox" checked={skill.enabled} onChange={(e) => onToggle(e.target.checked)} />
          {skill.enabled ? 'On' : 'Off'}
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Badge text={sourceLabel(skill.source)} color={skill.source === 'built_in' ? 'var(--accent)' : skill.source === 'suggested' ? 'var(--warning)' : 'var(--success)'} />
        <Badge text={skill.riskLevel} color={statusColor(skill.riskLevel)} />
        {skill.categories.slice(0, 3).map((c) => <Badge key={c} text={c} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 22 }}>
        {skill.requiredConnections.length > 0
          ? skill.requiredConnections.map((c) => <Badge key={c} text={c} color="var(--accent)" />)
          : <Badge text="No required connection" />}
      </div>
      <div style={{ marginTop: 'auto', fontSize: 11.5, color: 'var(--text-hint)' }}>Open</div>
    </button>
  );
}
