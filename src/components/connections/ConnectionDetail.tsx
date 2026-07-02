import { useState } from 'react';
import { Icon } from '../icons';
import { BrandIcon } from '../BrandIcon';
import { Badge, card, btn, ghostBtn, labelStyle } from '../pages/ui';
import type { ResolvedCatalogProvider } from '../../lib/connections/catalog';
import { getProvider } from '../../lib/connections/hub/status';
import { getProviderAuthConfig } from '../../lib/connections/providerAuth';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { ConnectionSetupModal } from './ConnectionSetupModal';
import { ConnectionToolsPanel } from './ConnectionToolsPanel';
import { actionLabel, statusExplanation } from './connection-ui-types';

function ImplBadges({ provider }: { provider: ResolvedCatalogProvider }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {provider.supportsNativeApi && <Badge text="Native API" color="var(--accent)" />}
      {provider.supportsMcp && <Badge text="MCP" color="#7C3AED" />}
    </div>
  );
}

function methodLabel(providerId: string, impl: ResolvedCatalogProvider['implementations'][number]): string {
  const auth = getProviderAuthConfig(providerId);
  if (impl.kind === 'native_api') {
    if (auth.supportsOAuth) return 'Connect with OAuth';
    if (auth.supportsUserApiKey) return auth.authMode === 'pat_user_entered' ? 'Connect with personal access token' : 'Connect with API key';
    return 'Native API';
  }
  if (impl.kind === 'remote_mcp') return 'Connect via remote MCP server';
  if (impl.kind === 'local_mcp') return 'Connect via local MCP server';
  return 'Manual setup';
}

function methodDescription(provider: ResolvedCatalogProvider, impl: ResolvedCatalogProvider['implementations'][number]): string {
  const auth = getProviderAuthConfig(provider.parentProviderId ?? provider.id);
  if (impl.kind === 'native_api') {
    if (provider.parentProviderId) return 'Uses the primary provider connection.';
    if (auth.supportsOAuth) return 'Users connect their own account. App-level OAuth credentials only enable the sign-in flow.';
    if (auth.supportsUserApiKey) return 'User-entered credentials are stored as connected-account secrets, never in .env.';
    return 'Native integration is available when runtime tools exist.';
  }
  if (impl.kind === 'remote_mcp') return 'Larund saves the MCP server URL, inspects discovered tools, and requires review before use.';
  if (impl.kind === 'local_mcp') return 'Run a local MCP server in Developer Mode.';
  return impl.instructions;
}

export function ConnectionDetail({
  provider,
  userId,
  isAdmin,
  projectId,
  compact,
  onBack,
  onChanged,
}: {
  provider: ResolvedCatalogProvider;
  userId: string;
  isAdmin: boolean;
  projectId?: string | null;
  compact?: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const setupProviderId = provider.parentProviderId ?? provider.id;
  const hubProvider = getProvider(setupProviderId);
  const auth = getProviderAuthConfig(setupProviderId);
  const connectable = provider.supportsNativeApi || provider.supportsMcp;

  return (
    <div style={{ padding: compact ? '4px 0' : 0 }}>
      <button style={{ ...ghostBtn, marginBottom: 14 }} onClick={onBack}>
        <Icon name="arrowLeft" size={13} stroke={1.8} /> Connections
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <BrandIcon providerId={provider.id} size={compact ? 44 : 52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: compact ? 17 : 21, fontWeight: 700, margin: 0 }}>{provider.name}</h1>
            <ConnectionStatusBadge state={provider.runtime} />
            <ImplBadges provider={provider} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>{provider.description}</p>
        </div>
        {connectable && (
          <button style={provider.runtime === 'connected' ? ghostBtn : btn} onClick={() => setSetupOpen(true)}>
            {actionLabel(provider.runtime)}
          </button>
        )}
      </div>

      <div style={{ ...card, borderColor: provider.runtime === 'developer_setup_missing' ? 'var(--warning)' : 'rgba(var(--ov-color),0.09)' }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Status</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {statusExplanation(provider, auth.appCredentials.requiredEnv, isAdmin)}
        </div>
      </div>

      <div style={card}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>How Larund can use this</div>
        {provider.implementations.map((impl, index) => (
          <div key={`${impl.kind}-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderTop: index ? '1px solid var(--border)' : 'none' }}>
            <Icon name={impl.kind === 'native_api' ? 'link' : impl.kind === 'remote_mcp' || impl.kind === 'local_mcp' ? 'diamond' : 'settings'} size={14} stroke={1.7} style={{ color: 'var(--accent)', marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{methodLabel(setupProviderId, impl)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 2 }}>{methodDescription(provider, impl)}</div>
            </div>
          </div>
        ))}
        {provider.supportsMcp && (
          <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 10, lineHeight: 1.5 }}>
            Only connect providers and MCP servers you trust. MCP tools can read and modify data depending on permissions.
          </div>
        )}
      </div>

      {(auth.scopes.length > 0 || provider.setupInstructions || provider.docsUrl) && (
        <div style={card}>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Permissions and setup</div>
          {auth.scopes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
              {auth.scopes.map((scope) => (
                <div key={scope.scope} style={{ fontSize: 11.5, color: scope.write ? 'var(--warning)' : 'var(--text-muted)' }}>
                  <code>{scope.scope}</code>{scope.description ? ` - ${scope.description}` : ''}
                </div>
              ))}
            </div>
          )}
          {provider.setupInstructions && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{provider.setupInstructions}</div>}
          {provider.docsUrl && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 6 }}>{provider.docsUrl}</div>}
        </div>
      )}

      <ConnectionToolsPanel providerId={provider.id} hubProvider={hubProvider} userId={userId} projectId={projectId} />

      {!hubProvider?.tools.length && provider.runtime === 'coming_soon' && (
        <div style={{ ...card, borderColor: 'var(--warning)', color: 'var(--text-muted)', fontSize: 12.5 }}>
          This integration is on the roadmap. Its native tools are not implemented yet{provider.supportsMcp ? ' - but you can connect it via an MCP server when available.' : '.'}
        </div>
      )}

      {setupOpen && (
        <ConnectionSetupModal
          providerId={setupProviderId}
          provider={provider}
          name={provider.parentProviderId ? 'Google Workspace' : provider.name}
          userId={userId}
          isAdmin={isAdmin}
          projectId={projectId}
          onClose={() => setSetupOpen(false)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}
