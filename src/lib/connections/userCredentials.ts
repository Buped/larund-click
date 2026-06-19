// Multi-field user API credentials for API-key / app-password providers
// (WordPress, WooCommerce, Shopify token path, HubSpot/Pipedrive private tokens…).
//
// SECURITY MODEL (matches connectedAccounts.ts)
//   • Every credential field value lives ONLY in the secure secret store
//     (setPersistentSecret → OS secure store via Tauri plugin-store, else
//     localStorage), under an opaque per-user/provider/field key.
//   • The ConnectedAccount record carries only the list of field NAMES
//     (metadata.credentialFields) + a display label — never any value.
//   • Values are surfaced to a provider tool's run() at call time via
//     resolveRuntimeCredentials, and are never returned to the model, UI, prompt,
//     logs or evidence (the audit logger redacts them regardless).

import {
  setPersistentSecret,
  loadPersistentSecret,
  getSecret,
} from './secrets';
import {
  createConnectedAccount,
  getConnectedAccount,
  listConnectedAccountsForProvider,
  disconnectConnectedAccount,
  DEFAULT_CONTEXT,
  type ConnectionContext,
  type ConnectedAccount,
} from './connectedAccounts';

/** Opaque secret-store key for one credential field of one user+provider. */
export function userSecretKey(ctx: ConnectionContext, providerId: string, field: string): string {
  return `usr:${ctx.userId}:${ctx.workspaceId ?? '-'}:${providerId}:${field}`;
}

/** Load the named credential fields for a provider from the secure secret store. */
export async function loadUserProviderSecrets(
  ctx: ConnectionContext,
  providerId: string,
  fields: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const key = userSecretKey(ctx, providerId, field);
    const value = getSecret(key) ?? (await loadPersistentSecret(key));
    if (value) out[field] = value;
  }
  return out;
}

export interface ConnectApiKeyInput {
  ctx?: ConnectionContext;
  providerId: string;
  /** Human label for the account/site/store (e.g. the site URL or store name). */
  accountLabel: string;
  /** Field name → value. Field names are the keys provider tools read from `secrets`. */
  fields: Record<string, string>;
  externalAccountEmail?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Connect an API-key/app-password provider: write every field value to the secure
 * secret store, then create a ConnectedAccount that records ONLY the field names.
 */
export async function connectApiKeyProvider(input: ConnectApiKeyInput): Promise<ConnectedAccount> {
  const ctx = input.ctx ?? DEFAULT_CONTEXT;
  const fieldNames = Object.keys(input.fields);
  for (const [field, value] of Object.entries(input.fields)) {
    if (!value) continue;
    await setPersistentSecret(userSecretKey(ctx, input.providerId, field), value);
  }
  // Replace any existing account for this provider (single API-key account per ctx).
  for (const existing of listConnectedAccountsForProvider(input.providerId, ctx)) {
    await disconnectConnectedAccount(existing.id);
  }
  return createConnectedAccount({
    ctx,
    providerId: input.providerId,
    accountLabel: input.accountLabel,
    authType: 'api_key',
    status: 'connected',
    externalAccountEmail: input.externalAccountEmail,
    metadata: { ...input.metadata, credentialFields: fieldNames },
  });
}

/** Disconnect an API-key provider: wipe its stored field values + remove the account. */
export async function disconnectApiKeyProvider(
  providerId: string,
  ctx: ConnectionContext = DEFAULT_CONTEXT,
): Promise<void> {
  const account = getConnectedAccount(providerId, ctx);
  const fields = (account?.metadata?.credentialFields as string[] | undefined) ?? [];
  for (const field of fields) {
    await setPersistentSecret(userSecretKey(ctx, providerId, field), '');
  }
  if (account) await disconnectConnectedAccount(account.id);
}

/** The credential field names recorded on a connected API-key account (no values). */
export function credentialFieldsForAccount(account: ConnectedAccount): string[] {
  return Array.isArray(account.metadata?.credentialFields)
    ? (account.metadata!.credentialFields as string[])
    : [];
}
