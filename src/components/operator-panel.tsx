import React from 'react';
import { listConnections } from '../lib/connections/registry';
import { listSkillMetadata } from '../lib/skills/runner';
import { getWorkflowEngine } from '../lib/workflows/runner';
import { TOOL_CATALOG } from '../lib/tools/registry';

const card: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(var(--ov-color),0.02)',
};
const badge = (color: string): React.CSSProperties => ({
  fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}`,
  borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase',
});

function statusColor(status: string): string {
  if (status === 'configured') return '#4ade80';
  if (status === 'missing_auth') return '#fbbf24';
  return '#94a3b8';
}

/**
 * Read-only operator surface: Connections, Skills, Workflows, and the tool
 * catalog with risk badges. The chat already renders tool calls, approvals and
 * the audit timeline inline per run.
 */
export function OperatorPanel() {
  const connections = listConnections();
  const skills = listSkillMetadata();
  const workflows = getWorkflowEngine().list();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 12 }}>
      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Connections</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {connections.map((c) => (
            <div key={c.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{c.name}</strong>
                <span style={badge(statusColor(c.status))}>{c.status.replace('_', ' ')}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{c.description}</span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{c.tools.length} tools · {c.authType}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Skills</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {skills.map((s) => (
            <div key={s.name} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 12 }}>{s.name}</strong>
                <span style={badge(s.enabled ? '#4ade80' : '#f87171')}>{s.source}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{s.description}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Workflows</h4>
        {workflows.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No workflows yet. Long-running tasks appear here.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workflows.map((w) => (
              <div key={w.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 12 }}>{w.name}</strong>
                  <span style={badge('#60a5fa')}>{w.status}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>step: {w.currentStep} · rev {w.revision}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Tool catalog</h4>
        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
          {TOOL_CATALOG.length} structured tools · CLI, files, browser pages, apps and connections.
        </span>
      </section>
    </div>
  );
}
