import { useState } from 'react';
import { BrandIcon } from '../BrandIcon';
import { card, btn, ghostBtn, input } from '../pages/ui';
import { isDeveloperUiEnabled } from '../../lib/admin';
import { getProvider } from '../../lib/connections/hub/status';
import type { ResolvedCatalogProvider } from '../../lib/connections/catalog';
import {
  disconnectConnectedAccount,
  listConnectedAccountsForProvider,
  updateConnectedAccount,
  type ConnectedAccount,
} from '../../lib/connections/connectedAccounts';
import { createConnectionRegistry } from '../../lib/connections/registry';
import { envSchemaForProvider } from '../../lib/connections/env/schema';
import { getProviderSecretSource, isDeveloperSetupReady } from '../../lib/connections/env/resolve';
import { getProviderAuthConfig } from '../../lib/connections/providerAuth';
import { beginOAuthConnect } from '../../lib/connections/oauth/connect';
import { redirectUriFor } from '../../lib/connections/oauth/flow';
import { setPersistentSecret } from '../../lib/connections/secrets';
import { connectApiKeyProvider, disconnectApiKeyProvider } from '../../lib/connections/userCredentials';
import { ConnectedAccountsList } from './ConnectedAccountsList';
import { ConnectionMcpPanel } from './ConnectionMcpPanel';
import {
  credentialFieldsForProvider,
  defaultMcpUrl,
  statusExplanation,
} from './connection-ui-types';

export function ConnectionSetupModal({
  providerId,
  provider,
  name,
  userId,
  isAdmin,
  projectId,
  onClose,
  onSaved,
}: {
  providerId: string;
  provider: ResolvedCatalogProvider;
  name: string;
  userId: string;
  isAdmin: boolean;
  projectId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = { userId, workspaceId: projectId ?? undefined };
  const schema = envSchemaForProvider(providerId);
  const auth = getProviderAuthConfig(providerId);
  const hubProvider = getProvider(providerId);
  const devReady = isDeveloperSetupReady(providerId);
  const devMode = isDeveloperUiEnabled(isAdmin);
  const accounts = listConnectedAccountsForProvider(providerId, ctx);
  const fields = credentialFieldsForProvider(providerId, hubProvider);

  const [appValues, setAppValues] = useState<Record<string, string>>({});
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [showDevSetup, setShowDevSetup] = useState(!devReady);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('');

  async function saveAppCreds() {
    const entries = Object.entries(appValues).filter(([, value]) => value.trim());
    for (const [key, value] of entries) await setPersistentSecret(key, value.trim());
    setStatus(entries.length ? `Saved ${entries.length} developer credential${entries.length === 1 ? '' : 's'}.` : 'No new values entered.');
    onSaved();
  }

  async function connectOAuth() {
    setConnecting(true);
    setStatus('Opening your browser to sign in...');
    try {
      const account = await beginOAuthConnect(providerId, ctx, { accountLabel: label.trim() || undefined });
      setLabel('');
      setStatus(`Connected ${account.accountLabel}.`);
      onSaved();
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      setStatus(
        message.includes('oauth_loopback_unavailable') ? 'Connecting requires the Larund desktop app.'
        : message.includes('oauth_cancelled') ? 'Sign-in was cancelled or timed out.'
        : message.includes('oauth_state_mismatch') ? 'Security check failed. Please try again.'
        : message.includes('developer_setup_missing') ? 'Larund developer setup is missing for this provider.'
        : `Connect failed: ${message}`,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function connectUserCredentials() {
    const values = Object.fromEntries(
      fields
        .map((field) => [field.name, credentialValues[field.name]?.trim() ?? ''] as const)
        .filter(([, value]) => value.length > 0),
    );
    const missing = fields.filter((field) => !values[field.name]);
    if (missing.length > 0) {
      setStatus(`Enter ${missing.map((field) => field.label).join(', ')} to connect.`);
      return;
    }
    await connectApiKeyProvider({
      ctx,
      providerId,
      accountLabel: label.trim() || values.WORDPRESS_SITE_URL || values.WOOCOMMERCE_STORE_URL || `${name} account`,
      fields: values,
      metadata: { authMode: auth.authMode },
    });
    setCredentialValues({});
    setLabel('');
    setStatus('Connected. Your credentials are stored as user secrets, never in .env.');
    onSaved();
  }

  async function disconnect(account: ConnectedAccount) {
    if (account.authType === 'api_key') await disconnectApiKeyProvider(providerId, ctx);
    else await disconnectConnectedAccount(account.id);
    setStatus('Account disconnected.');
    onSaved();
  }

  async function test(account: ConnectedAccount) {
    const hub = getProvider(providerId);
    const testTool = hub?.tools.find((tool) => tool.name.endsWith('.test_connection'))
      ?? hub?.tools.find((tool) => tool.risk === 'read_only' || tool.risk === 'external_read');
    if (!testTool) {
      setStatus('No safe read-only test is implemented for this provider yet.');
      return;
    }
    const result = await createConnectionRegistry(userId, projectId ?? undefined).call(providerId, testTool.name, {});
    await updateConnectedAccount(account.id, { lastTestedAt: new Date().toISOString() });
    setStatus(result.output || (result.success ? `Connection test passed for ${account.accountLabel}.` : `Test failed: ${result.error ?? 'unknown error'}`));
    onSaved();
  }

  const appKeys = [...auth.appCredentials.requiredEnv, ...auth.appCredentials.optionalEnv];
  const showDevCard = appKeys.length > 0 && devMode;
  const isOAuth = auth.supportsOAuth;
  const isUserKey = auth.supportsUserApiKey;

  return (
    <div className="scrim" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 130, background: 'rgba(0,0,0,.65)' }}>
      <div className="modal-pop" style={{ width: 560, maxWidth: '92vw', maxHeight: '88vh', overflow: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-md)', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <BrandIcon providerId={providerId} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Connect {name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
              {isOAuth ? 'Sign in with your account' : isUserKey ? 'Add your user credentials' : auth.authMode.replace(/_/g, ' ')}
            </div>
          </div>
        </div>

        <ConnectedAccountsList accounts={accounts} onTest={(account) => void test(account)} onDisconnect={(account) => void disconnect(account)} />

        <div style={card}>
          {isOAuth ? (
            !devReady ? (
              <div style={{ fontSize: 12.5, color: 'var(--warning)', lineHeight: 1.5 }}>
                {statusExplanation(provider, auth.appCredentials.requiredEnv, devMode)}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                  Click connect, sign in to {name} in your browser, and Larund will store your connected account token securely.
                </div>
                <input style={{ ...input, marginBottom: 8 }} type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label this account (optional, e.g. work)" />
                <button style={{ ...btn, width: '100%', justifyContent: 'center', opacity: connecting ? 0.6 : 1 }} disabled={connecting} onClick={connectOAuth}>
                  {connecting ? 'Waiting for sign-in...' : accounts.length ? `Connect another ${name} account` : `Connect ${name}`}
                </button>
              </>
            )
          ) : isUserKey ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                Paste your API key, PAT, or provider credential fields. They are stored as user secrets, never in .env.
              </div>
              <input style={input} type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label this account (optional)" />
              {fields.map((field) => (
                <div key={field.name} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-hint)', marginBottom: 4 }}>{field.label}</div>
                  <input
                    style={input}
                    type={field.secret ? 'password' : 'text'}
                    value={credentialValues[field.name] ?? ''}
                    onChange={(event) => setCredentialValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
              <button style={{ ...btn, marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={connectUserCredentials}>Connect</button>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {provider.supportsMcp ? 'Connect this provider through its MCP server below.' : 'This connection is not configurable yet.'}
            </div>
          )}
        </div>

        {provider.supportsMcp && (
          <ConnectionMcpPanel providerId={provider.id} name={provider.name} defaultUrl={defaultMcpUrl(provider)} userId={userId} projectId={projectId} onChanged={onSaved} />
        )}

        {showDevCard && (
          <div style={{ ...card, marginTop: 12, borderColor: devReady ? 'var(--border)' : 'var(--warning)' }}>
            <button style={{ ...ghostBtn, marginBottom: showDevSetup ? 8 : 0 }} onClick={() => setShowDevSetup((value) => !value)}>
              {showDevSetup ? 'Hide developer setup' : 'Developer setup'} {devReady ? 'ready' : 'required'}
            </button>
            {showDevSetup && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  App-level OAuth credentials are configured once by the Larund developer so users can connect their own accounts. Developer credentials are not user tokens. Register <code>{redirectUriFor()}</code> as the redirect URI.
                </div>
                {appKeys.map((key) => {
                  const configured = getProviderSecretSource(providerId, key) !== 'missing';
                  const required = auth.appCredentials.requiredEnv.includes(key);
                  return (
                    <div key={key} style={{ marginTop: 8 }}>
                      <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{key}{required ? '' : ' (optional)'}</code>
                      <input
                        style={{ ...input, marginTop: 4 }}
                        type="password"
                        value={appValues[key] ?? ''}
                        onChange={(event) => setAppValues((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder={configured ? 'Configured: ******' : 'Paste value'}
                      />
                    </div>
                  );
                })}
                <button style={{ ...btn, marginTop: 10 }} onClick={saveAppCreds}>Save developer credentials</button>
              </>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 12 }}>Write, send, publish, and destructive tools require approval before Larund runs them.</div>
        {schema.notes && <div style={{ fontSize: 11.5, color: 'var(--text-hint)', marginTop: 6 }}>{schema.notes}</div>}
        {provider.docsUrl && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 4 }}>Provider docs: {provider.docsUrl}</div>}
        {status && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{status}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={ghostBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
