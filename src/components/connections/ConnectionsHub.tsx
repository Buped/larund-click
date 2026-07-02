import { useEffect, useState } from 'react';
import { Empty, PageHeader, SearchInput, labelStyle } from '../pages/ui';
import { isDeveloperUiEnabled } from '../../lib/admin';
import { listCatalogProviders } from '../../lib/connections/catalog';
import type { ResolvedCatalogProvider, RuntimeConnectionState } from '../../lib/connections/catalog';
import { getProviderAuthConfig } from '../../lib/connections/providerAuth';
import { listConnectedAccountsForProvider } from '../../lib/connections/connectedAccounts';
import { higgsfieldConnectionState } from '../../lib/mcp/higgsfield/connect';
import { mcpProviderState } from '../../lib/mcp/connect-provider';
import { HiggsfieldDetail } from './HiggsfieldDetail';
import { ConnectionCard } from './ConnectionCard';
import { ConnectionDetail } from './ConnectionDetail';
import { ConnectionFilters } from './ConnectionFilters';
import {
  NEEDS_SETUP,
  PAGE_FILTERS,
  SETTINGS_FILTERS,
  STATE_RANK,
  mcpStateToRuntime,
  type ConnectionFilter,
  type ConnectionsHubProps,
} from './connection-ui-types';

function normalizeInitialFilter(value: string | undefined, filters: readonly ConnectionFilter[]): ConnectionFilter {
  return filters.includes(value as ConnectionFilter) ? value as ConnectionFilter : filters[0];
}

function byRank(a: ResolvedCatalogProvider, b: ResolvedCatalogProvider): number {
  return STATE_RANK[a.runtime] - STATE_RANK[b.runtime] || a.name.localeCompare(b.name);
}

function providerMatches(provider: ResolvedCatalogProvider, filter: ConnectionFilter, query: string): boolean {
  if (query && !`${provider.name} ${provider.description}`.toLowerCase().includes(query.toLowerCase())) return false;
  switch (filter) {
    case 'All':
      return true;
    case 'Connected':
      return provider.runtime === 'connected' || provider.runtime === 'dev_shortcut_active';
    case 'Needs setup':
      return NEEDS_SETUP.includes(provider.runtime);
    case 'Native API':
      return provider.supportsNativeApi;
    case 'MCP':
    case 'MCP available':
      return provider.supportsMcp;
    default:
      return provider.category === filter.toLowerCase();
  }
}

export function ConnectionsHub({
  userId,
  projectId,
  isAdmin,
  variant = 'page',
  initialFilter,
  compact,
  showHeader = variant === 'page',
  showSearch = true,
  showFilters = true,
  showUpcomingToggle = variant === 'page',
  onConnectionChanged,
}: ConnectionsHubProps) {
  const ctx = { userId, workspaceId: projectId ?? undefined };
  const filters = variant === 'settings' ? SETTINGS_FILTERS : PAGE_FILTERS;
  const [base, setBase] = useState<ResolvedCatalogProvider[]>(() => listCatalogProviders(ctx));
  const [mcpRuntime, setMcpRuntime] = useState<Record<string, RuntimeConnectionState>>({});
  const [filter, setFilter] = useState<ConnectionFilter>(() => normalizeInitialFilter(initialFilter, filters));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  async function loadMcpRuntime() {
    const overrides: Record<string, RuntimeConnectionState> = {};
    for (const provider of listCatalogProviders(ctx)) {
      if (provider.status !== 'mcp_available') continue;
      try {
        const state = provider.id === 'higgsfield'
          ? (await higgsfieldConnectionState(ctx)).state
          : (await mcpProviderState(provider.id, ctx)).state;
        const mapped = mcpStateToRuntime(state);
        if (mapped) overrides[provider.id] = mapped;
      } catch {
        // Keep the synchronous catalog state when the async MCP store is unavailable.
      }
    }
    setMcpRuntime(overrides);
  }

  function refresh() {
    setBase(listCatalogProviders(ctx));
    void loadMcpRuntime();
    onConnectionChanged?.();
  }

  useEffect(() => {
    setBase(listCatalogProviders(ctx));
    void loadMcpRuntime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, projectId]);

  const providers = base.map((provider) => (mcpRuntime[provider.id] ? { ...provider, runtime: mcpRuntime[provider.id] } : provider));
  const selected = providers.find((provider) => provider.id === selectedId);

  if (selected?.id === 'higgsfield') {
    const detail = <HiggsfieldDetail userId={userId} projectId={projectId} onBack={() => { setSelectedId(null); refresh(); }} framed={false} />;
    if (variant === 'settings') {
      return (
        <div className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center' }}>
          <div className="modal-pop scroll" style={{ width: 660, maxWidth: '94vw', maxHeight: '88vh', overflow: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 18 }}>
            {detail}
          </div>
        </div>
      );
    }
    return detail;
  }

  if (selected) {
    const detail = (
      <ConnectionDetail
        provider={selected}
        userId={userId}
        isAdmin={isAdmin}
        projectId={projectId}
        compact={compact || variant === 'settings'}
        onBack={() => { setSelectedId(null); refresh(); }}
        onChanged={refresh}
      />
    );
    if (variant === 'settings') {
      return (
        <>
          <ConnectionsHub
            userId={userId}
            projectId={projectId}
            isAdmin={isAdmin}
            variant={variant}
            initialFilter={filter}
            compact={compact}
            showHeader={showHeader}
            showSearch={showSearch}
            showFilters={showFilters}
            showUpcomingToggle={showUpcomingToggle}
            onConnectionChanged={onConnectionChanged}
          />
          <div className="scrim" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center' }}>
            <div className="modal-pop scroll" style={{ width: 660, maxWidth: '94vw', maxHeight: '88vh', overflow: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 18 }}>
              {detail}
            </div>
          </div>
        </>
      );
    }
    return detail;
  }

  const matched = providers.filter((provider) => providerMatches(provider, filter, query));
  const main = variant === 'settings'
    ? matched.sort(byRank)
    : matched.filter((provider) => provider.runtime !== 'coming_soon').sort(byRank);
  const upcoming = variant === 'page' && showUpcoming
    ? matched.filter((provider) => provider.runtime === 'coming_soon').sort(byRank)
    : [];
  const developerSetupVisible = isDeveloperUiEnabled(isAdmin);

  const grid = (items: ResolvedCatalogProvider[]) => (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact || variant === 'settings' ? 205 : 240}px, 1fr))`, gap: compact || variant === 'settings' ? 9 : 12 }}>
      {items.map((provider) => {
        const baseId = provider.parentProviderId ?? provider.id;
        const account = listConnectedAccountsForProvider(baseId, ctx)[0];
        const requiredEnv = getProviderAuthConfig(baseId).appCredentials.requiredEnv;
        return (
          <ConnectionCard
            key={provider.id}
            provider={provider}
            account={account}
            compact={compact || variant === 'settings'}
            requiredEnv={requiredEnv}
            isDeveloperSetupVisible={developerSetupVisible}
            onSelect={() => setSelectedId(provider.id)}
          />
        );
      })}
    </div>
  );

  return (
    <div data-testid="connections-hub">
      {showHeader && <PageHeader title="Connections" subtitle="Connect Larund to the tools you already use." />}
      {showSearch && <SearchInput value={query} onChange={setQuery} placeholder="Search connections..." />}
      {showFilters && (
        <ConnectionFilters
          filters={filters}
          value={filter}
          onChange={setFilter}
          showUpcomingToggle={showUpcomingToggle}
          showUpcoming={showUpcoming}
          onToggleUpcoming={() => setShowUpcoming((value) => !value)}
        />
      )}

      {grid(main)}
      {main.length === 0 && upcoming.length === 0 && <Empty text="No connections match your search." icon="link" />}

      {upcoming.length > 0 && (
        <>
          <div style={{ ...labelStyle, margin: '22px 0 10px' }}>Available soon</div>
          {grid(upcoming)}
        </>
      )}
    </div>
  );
}
