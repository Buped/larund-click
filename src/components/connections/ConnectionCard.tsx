import { BrandIcon } from '../BrandIcon';
import { Badge, ghostBtn, btn } from '../pages/ui';
import type { ResolvedCatalogProvider } from '../../lib/connections/catalog';
import type { ConnectedAccount } from '../../lib/connections/connectedAccounts';
import { actionLabel, isLiveConnection, RUNTIME_LABEL, statusExplanation } from './connection-ui-types';

function ImplBadges({ provider }: { provider: ResolvedCatalogProvider }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {provider.supportsNativeApi && <Badge text="Native API" color="var(--accent)" />}
      {provider.supportsMcp && <Badge text="MCP" color="#7C3AED" />}
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ConnectionCard({
  provider,
  account,
  compact,
  requiredEnv,
  isDeveloperSetupVisible,
  onSelect,
}: {
  provider: ResolvedCatalogProvider;
  account?: ConnectedAccount;
  compact?: boolean;
  requiredEnv: string[];
  isDeveloperSetupVisible: boolean;
  onSelect: () => void;
}) {
  const label = RUNTIME_LABEL[provider.runtime];
  const live = isLiveConnection(provider.runtime);
  const accountLine = account?.externalAccountEmail ?? account?.externalWorkspaceName ?? account?.accountLabel;
  const lastTested = formatDate(account?.lastTestedAt);

  return (
    <div
      className="conn-card"
      style={{
        cursor: 'default',
        opacity: live ? 1 : 0.86,
        minHeight: compact ? 160 : 190,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <button
        onClick={onSelect}
        style={{ appearance: 'none', border: 'none', padding: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <BrandIcon providerId={provider.id} size={compact ? 34 : 38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{provider.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-hint)', textTransform: 'capitalize' }}>{provider.category}</div>
          </div>
        </div>
        <div style={{ fontSize: compact ? 11.5 : 12, color: 'var(--text-muted)', lineHeight: 1.45, minHeight: compact ? 30 : 34 }}>{provider.description}</div>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
        <span style={{ fontSize: 11, color: label.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="dot" style={{ background: label.color }} /> {label.text}
        </span>
        <div style={{ flex: 1 }} />
        <ImplBadges provider={provider} />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-hint)', lineHeight: 1.4 }}>
        {accountLine ? `Connected as ${accountLine}` : statusExplanation(provider, requiredEnv, isDeveloperSetupVisible)}
        {lastTested && <span> · Last tested {lastTested}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        {provider.nativeToolCount > 0 && <span style={{ fontSize: 10.5, color: 'var(--text-hint)' }}>{provider.nativeToolCount} tools</span>}
        <div style={{ flex: 1 }} />
        <button style={provider.runtime === 'connected' ? ghostBtn : btn} onClick={onSelect}>
          {actionLabel(provider.runtime)}
        </button>
      </div>
    </div>
  );
}
