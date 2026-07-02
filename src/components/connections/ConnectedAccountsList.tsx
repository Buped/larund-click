import { ghostBtn, labelStyle, card } from '../pages/ui';
import type { ConnectedAccount } from '../../lib/connections/connectedAccounts';

function accountDetail(account: ConnectedAccount): string {
  const parts: string[] = [account.status];
  if (account.externalAccountEmail) parts.push(account.externalAccountEmail);
  if (account.externalWorkspaceName) parts.push(account.externalWorkspaceName);
  if (account.lastTestedAt) {
    try {
      parts.push(`tested ${new Date(account.lastTestedAt).toLocaleString()}`);
    } catch {
      // Keep the metadata invisible if it is malformed.
    }
  }
  return parts.join(' · ');
}

export function ConnectedAccountsList({
  accounts,
  onTest,
  onDisconnect,
}: {
  accounts: ConnectedAccount[];
  onTest: (account: ConnectedAccount) => void;
  onDisconnect: (account: ConnectedAccount) => void;
}) {
  if (accounts.length === 0) return null;
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Connected accounts</div>
      {accounts.map((account) => (
        <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{account.accountLabel}</div>
            <div style={{ fontSize: 11, color: account.status === 'connected' ? 'var(--success)' : 'var(--warning)' }}>{accountDetail(account)}</div>
          </div>
          <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => onTest(account)}>Test</button>
          <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11, color: 'var(--danger)' }} onClick={() => onDisconnect(account)}>Disconnect</button>
        </div>
      ))}
    </div>
  );
}
