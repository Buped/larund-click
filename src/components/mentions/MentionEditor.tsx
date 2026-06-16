// Reusable @-mention editor used by the Automation goal/step editors (and usable
// in Chat). The user types `@` to open a grouped dropdown of Skills / Connections
// / MCP / Memory / Workflows; selecting one inserts an `@Label` token into the
// text AND records a structured ReferencedContext. The text + structured refs are
// kept together so the agent runtime receives real context, not just a label.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { listMentionResources } from '../../lib/mentions/resources';
import { MENTION_COLORS, MENTION_TABS, resourceToReference, type MentionKind, type MentionResource, type ReferencedContext } from '../../lib/mentions/types';

export function MentionChip({ refItem, onRemove }: { refItem: ReferencedContext; onRemove?: () => void }) {
  const color = MENTION_COLORS[refItem.kind];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', borderRadius: 6, fontSize: 11.5, background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      <span style={{ opacity: 0.75 }}>{refItem.kind}</span>
      {refItem.label}
      {onRemove && <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color, display: 'grid', placeItems: 'center', padding: 0 }}><Icon name="x" size={9} stroke={2.4} /></button>}
    </span>
  );
}

export function MentionEditor({
  value, references, onChange, placeholder, userId, workspaceId, kinds, minHeight = 90,
}: {
  value: string;
  references: ReferencedContext[];
  onChange: (text: string, refs: ReferencedContext[]) => void;
  placeholder?: string;
  userId: string;
  workspaceId?: string;
  kinds?: MentionKind[];
  minHeight?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MentionKind>('connection');
  const [resources, setResources] = useState<MentionResource[]>([]);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);

  const tabs = useMemo(() => MENTION_TABS.filter((t) => !kinds || kinds.includes(t.kind)), [kinds]);

  async function loadResources() {
    setResources(await listMentionResources({ userId, workspaceId, kinds }).catch(() => []));
  }
  useEffect(() => { if (open && resources.length === 0) void loadResources(); /* eslint-disable-next-line */ }, [open]);

  function openPicker() { setOpen(true); setTrigger(null); void loadResources(); }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text, references);
    // Detect an active "@token" ending at the caret.
    const caret = e.target.selectionStart ?? text.length;
    const upto = text.slice(0, caret);
    const m = upto.match(/(^|\s)@([\w-]*)$/);
    if (m) {
      setTrigger({ start: caret - m[2].length - 1, query: m[2] });
      setOpen(true);
      if (resources.length === 0) void loadResources();
    } else if (trigger) {
      setTrigger(null);
    }
  }

  function insert(resource: MentionResource) {
    const ref = resourceToReference(resource);
    const ta = taRef.current;
    let text = value;
    if (trigger) {
      // Replace the typed "@query" with the chosen "@Label ".
      text = `${value.slice(0, trigger.start)}${ref.displayText} ${value.slice(trigger.start + 1 + trigger.query.length)}`;
    } else {
      const caret = ta?.selectionStart ?? value.length;
      const needsSpace = caret > 0 && !/\s$/.test(value.slice(0, caret));
      text = `${value.slice(0, caret)}${needsSpace ? ' ' : ''}${ref.displayText} ${value.slice(caret)}`;
    }
    const nextRefs = references.some((r) => r.kind === ref.kind && r.refId === ref.refId) ? references : [...references, ref];
    onChange(text, nextRefs);
    setOpen(false); setTrigger(null);
    setTimeout(() => ta?.focus(), 0);
  }

  function removeRef(id: string) {
    onChange(value, references.filter((r) => r.id !== id));
  }

  const query = (trigger?.query ?? '').toLowerCase();
  const filtered = resources
    .filter((r) => r.kind === tab)
    .filter((r) => !query || r.label.toLowerCase().includes(query));

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Describe what Larund should do… type @ to add a skill, connection, MCP, memory or workflow.'}
        style={{ width: '100%', minHeight, resize: 'vertical', background: 'rgba(10,10,8,0.46)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none', lineHeight: 1.55, boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={openPicker} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border-md)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="plus" size={12} stroke={2} /> Add reference
        </button>
        {references.map((r) => <MentionChip key={r.id} refItem={r} onRemove={() => removeRef(r.id)} />)}
      </div>

      {open && (
        <div className="fade-up" style={{ position: 'absolute', top: minHeight + 4, left: 0, width: 340, zIndex: 80, background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,.6)', overflow: 'hidden' }} onMouseDown={(e) => e.preventDefault()}>
          <div style={{ display: 'flex', gap: 2, padding: 6, borderBottom: '1px solid var(--border)' }}>
            {tabs.map((t) => (
              <button key={t.kind} onClick={() => setTab(t.kind)} style={{ flex: 1, fontSize: 11, padding: '5px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tab === t.kind ? `${MENTION_COLORS[t.kind]}22` : 'transparent', color: tab === t.kind ? MENTION_COLORS[t.kind] : 'var(--text-hint)', fontWeight: tab === t.kind ? 650 : 400 }}>{t.label}</button>
            ))}
          </div>
          <div className="scroll" style={{ maxHeight: 240, overflow: 'auto', padding: 4 }}>
            {filtered.length === 0 && <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--text-hint)' }}>No {tab}s found.</div>}
            {filtered.map((r) => (
              <button key={`${r.kind}:${r.refId}`} onClick={() => insert(r)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: MENTION_COLORS[r.kind], flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  {r.detail && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-hint)' }}>{r.detail}</span>}
                </span>
                {!r.available && <span style={{ fontSize: 10, color: 'var(--warning)' }}>setup</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
