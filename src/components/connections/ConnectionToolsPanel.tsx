import { useState } from 'react';
import { card, labelStyle } from '../pages/ui';
import type { ConnectionProvider } from '../../lib/connections/hub/types';
import {
  getToolPolicy,
  RISK_GROUPS,
  setToolPolicy,
  type ToolPolicy,
} from './connection-ui-types';

export function ConnectionToolsPanel({
  providerId,
  hubProvider,
  userId,
  projectId,
}: {
  providerId: string;
  hubProvider?: ConnectionProvider;
  userId: string;
  projectId?: string | null;
}) {
  const [, force] = useState(0);
  if (!hubProvider || hubProvider.tools.length === 0) return null;

  function changePolicy(tool: string, policy: ToolPolicy) {
    setToolPolicy(userId, projectId, providerId, tool, policy);
    force((value) => value + 1);
  }

  return (
    <>
      <div style={card}>
        <strong style={{ fontSize: 13 }}>What Larund can do</strong>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>
          {hubProvider.tools.length} tools · auth: {hubProvider.authType}
          {hubProvider.scopes.length ? ` · scopes: ${hubProvider.scopes.join(', ')}` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>
          Send, publish, destructive, and process execution actions require approval before Larund runs them.
        </div>
      </div>
      {RISK_GROUPS.map((group) => {
        const tools = hubProvider.tools.filter((tool) => group.risks.includes(tool.risk));
        if (tools.length === 0) return null;
        return (
          <div key={group.label} style={card}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>{group.label} tools</div>
            {tools.map((tool) => {
              const policy = getToolPolicy(userId, projectId, providerId, tool.name, tool.risk);
              return (
                <div key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{tool.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>{tool.description}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 3, flex: 'none' }}>
                    {(['allow', 'ask', 'block'] as ToolPolicy[]).map((option) => (
                      <button
                        key={option}
                        onClick={() => changePolicy(tool.name, option)}
                        style={{
                          fontSize: 10.5,
                          padding: '4px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          border: '1px solid var(--border)',
                          background: policy === option ? (option === 'block' ? 'var(--danger)' : option === 'ask' ? 'var(--warning)' : 'var(--success)') : 'transparent',
                          color: policy === option ? 'var(--on-accent)' : 'var(--text-hint)',
                          fontWeight: policy === option ? 650 : 400,
                        }}
                      >
                        {option === 'ask' ? 'Ask' : option === 'allow' ? 'Allow' : 'Block'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
