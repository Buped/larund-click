import type { ConnectionCallResult } from '../../types';

export type XOperationCode =
  | 'owned_read'
  | 'post_read'
  | 'user_read'
  | 'post_create_standard'
  | 'post_create_with_url'
  | 'media_upload';

export interface XPricingRow {
  operation_code: XOperationCode;
  description: string;
  usd_cost_per_unit: number;
  markup_multiplier: number;
  uc_cost_per_unit: number;
  last_verified_at: string;
  is_active: boolean;
  notes?: string;
}

export interface XUsageCharge {
  userId?: string;
  operationCode: XOperationCode;
  unitCount: number;
  relatedPostId?: string;
  relatedUserId?: string;
  cacheKey?: string;
  success: boolean;
}

const DEFAULT_PRICING: Record<XOperationCode, XPricingRow> = {
  owned_read: {
    operation_code: 'owned_read',
    description: 'Connected account owned read: own timeline, bookmarks and lists',
    usd_cost_per_unit: 0.001,
    markup_multiplier: 10,
    uc_cost_per_unit: 1,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
  post_read: {
    operation_code: 'post_read',
    description: 'Public post search/read',
    usd_cost_per_unit: 0.005,
    markup_multiplier: 10,
    uc_cost_per_unit: 5,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
  user_read: {
    operation_code: 'user_read',
    description: 'Public user/profile read',
    usd_cost_per_unit: 0.01,
    markup_multiplier: 10,
    uc_cost_per_unit: 10,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
  post_create_standard: {
    operation_code: 'post_create_standard',
    description: 'Create a post without URL',
    usd_cost_per_unit: 0.015,
    markup_multiplier: 10,
    uc_cost_per_unit: 15,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
  post_create_with_url: {
    operation_code: 'post_create_with_url',
    description: 'Create a post containing a URL',
    usd_cost_per_unit: 0.2,
    markup_multiplier: 10,
    uc_cost_per_unit: 200,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
  media_upload: {
    operation_code: 'media_upload',
    description: 'Media upload marker; X cost is accounted in create post',
    usd_cost_per_unit: 0,
    markup_multiplier: 1,
    uc_cost_per_unit: 0,
    last_verified_at: '2026-06-23',
    is_active: true,
  },
};

const HIGH_COST_DEFAULT_UC = 50;
const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'x_api_dedup_cache:';
const USAGE_LOG_KEY = 'x_api_usage_log';

function nowIso(): string {
  return new Date().toISOString();
}

function safeStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

async function supabaseClient(): Promise<unknown | null> {
  try {
    const mod = await import('../../../supabase');
    return mod.supabase;
  } catch {
    return null;
  }
}

function cacheId(userId: string | undefined, key: string): string {
  return `${CACHE_PREFIX}${userId || 'anonymous'}:${key}`;
}

export function containsUrl(text: string): boolean {
  return /\bhttps?:\/\/\S+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?/i.test(text);
}

export function unavailableXOperationMessage(operation: string): ConnectionCallResult {
  return {
    success: false,
    output: '',
    error: `unavailable_operation: ${operation} is not available in the Larund X integration. X exposes this only through Enterprise-level access; use "Open on X" so the user can do it manually.`,
    details: { provider: 'x', operation, openOnXOnly: true },
  };
}

export async function getXPricing(operationCode: XOperationCode): Promise<XPricingRow> {
  const fallback = DEFAULT_PRICING[operationCode];
  const client = await supabaseClient() as {
    from?: (table: string) => {
      select: (cols: string) => { eq: (col: string, value: string) => { maybeSingle: () => Promise<{ data?: unknown; error?: unknown }> } };
    };
  } | null;
  if (!client?.from) return fallback;
  try {
    const { data, error } = await client
      .from('x_api_pricing')
      .select('operation_code, description, usd_cost_per_unit, markup_multiplier, uc_cost_per_unit, last_verified_at, is_active, notes')
      .eq('operation_code', operationCode)
      .maybeSingle();
    if (error || !data) return fallback;
    const row = data as Partial<XPricingRow>;
    if (row.is_active === false) return fallback;
    return {
      ...fallback,
      ...row,
      usd_cost_per_unit: Number(row.usd_cost_per_unit ?? fallback.usd_cost_per_unit),
      markup_multiplier: Number(row.markup_multiplier ?? fallback.markup_multiplier),
      uc_cost_per_unit: Number(row.uc_cost_per_unit ?? fallback.uc_cost_per_unit),
      operation_code: operationCode,
    };
  } catch {
    return fallback;
  }
}

export async function estimateXOperationCost(operationCode: XOperationCode, unitCount = 1): Promise<{ pricing: XPricingRow; ucCost: number; needsConfirmation: boolean }> {
  const pricing = await getXPricing(operationCode);
  const ucCost = Math.max(0, pricing.uc_cost_per_unit * Math.max(1, unitCount));
  const threshold = Number(safeStorage()?.getItem('x_api_confirmation_threshold_uc') ?? HIGH_COST_DEFAULT_UC);
  return { pricing, ucCost, needsConfirmation: ucCost >= threshold };
}

export async function preflightXOperation(args: {
  userId?: string;
  operationCode: XOperationCode;
  unitCount?: number;
  confirmed?: boolean;
}): Promise<{ ok: true; ucCost: number; needsConfirmation: boolean } | { ok: false; result: ConnectionCallResult }> {
  const estimate = await estimateXOperationCost(args.operationCode, args.unitCount ?? 1);
  if (estimate.needsConfirmation && !args.confirmed) {
    return {
      ok: false,
      result: {
        success: false,
        output: '',
        error: `cost_confirmation_required: Ez az X-művelet kb. ${estimate.ucCost} UC-t fog levonni az egyenlegedből. Erősítsd meg a futtatáshoz.`,
        details: { provider: 'x', operationCode: args.operationCode, requiredUc: estimate.ucCost, needsConfirmation: true },
      },
    };
  }
  const balance = await hasEnoughCredits(args.userId, estimate.ucCost);
  if (!balance.ok) {
    return {
      ok: false,
      result: {
        success: false,
        output: '',
        error: `insufficient_uc: Nincs elég UC-egyenleged ehhez az X-művelethez (szükséges: ${estimate.ucCost} UC, jelenlegi egyenleg: ${balance.balance} UC).`,
        details: { provider: 'x', requiredUc: estimate.ucCost, currentUc: balance.balance, operationCode: args.operationCode },
      },
    };
  }
  return { ok: true, ucCost: estimate.ucCost, needsConfirmation: estimate.needsConfirmation };
}

export function isXCacheHit(userId: string | undefined, cacheKey: string | undefined): boolean {
  if (!cacheKey) return false;
  const raw = safeStorage()?.getItem(cacheId(userId, cacheKey));
  if (!raw) return false;
  try {
    const item = JSON.parse(raw) as { cachedAt: string };
    return Date.now() - Date.parse(item.cachedAt) < TTL_MS;
  } catch {
    return false;
  }
}

export function markXCache(userId: string | undefined, cacheKey: string | undefined): void {
  if (!cacheKey) return;
  safeStorage()?.setItem(cacheId(userId, cacheKey), JSON.stringify({ cachedAt: nowIso() }));
}

async function logUsage(charge: XUsageCharge, ucDeducted: number, message?: string): Promise<void> {
  const entry = {
    user_id: charge.userId,
    operation_code: charge.operationCode,
    unit_count: charge.unitCount,
    uc_deducted: ucDeducted,
    success: charge.success,
    related_post_id: charge.relatedPostId,
    related_user_id: charge.relatedUserId,
    message,
    timestamp: nowIso(),
  };
  const storage = safeStorage();
  if (storage) {
    const current = JSON.parse(storage.getItem(USAGE_LOG_KEY) || '[]') as unknown[];
    current.unshift(entry);
    storage.setItem(USAGE_LOG_KEY, JSON.stringify(current.slice(0, 300)));
  }

  const client = await supabaseClient() as {
    from?: (table: string) => { insert: (payload: unknown) => Promise<unknown> };
  } | null;
  try { await client?.from?.('x_api_usage_log').insert(entry); } catch { /* local fallback already logged */ }
}

async function hasEnoughCredits(userId: string | undefined, ucCost: number): Promise<{ ok: true } | { ok: false; balance: number }> {
  if (!userId || ucCost <= 0) return { ok: true };
  const client = await supabaseClient() as {
    from?: (table: string) => {
      select: (cols: string) => { eq: (col: string, value: string) => { single: () => Promise<{ data?: { uc_balance?: number }; error?: unknown }> } };
    };
  } | null;
  if (!client?.from) return { ok: true };
  try {
    const { data, error } = await client.from('user_credits').select('uc_balance').eq('user_id', userId).single();
    if (error || !data) return { ok: true };
    const balance = Number(data.uc_balance ?? 0);
    return balance >= ucCost ? { ok: true } : { ok: false, balance };
  } catch {
    return { ok: true };
  }
}

async function deductCredits(userId: string | undefined, ucCost: number, operationCode: XOperationCode): Promise<void> {
  if (!userId || ucCost <= 0) return;
  const client = await supabaseClient() as {
    rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ error?: unknown }>;
  } | null;
  if (!client?.rpc) return;
  const attempts = [
    { p_user_id: userId, p_amount: ucCost, p_reason: `x_api:${operationCode}` },
    { user_id: userId, amount: ucCost, reason: `x_api:${operationCode}` },
    { p_user_id: userId, p_uc_amount: ucCost, p_operation: `x_api:${operationCode}` },
  ];
  for (const args of attempts) {
    try {
      const { error } = await client.rpc('deduct_uc_credits', args);
      if (!error) return;
    } catch {
      // Try the next known RPC shape.
    }
  }
}

export async function chargeXUsage(charge: XUsageCharge): Promise<{ charged: boolean; ucCost: number; cached: boolean; error?: ConnectionCallResult }> {
  if (!charge.success) {
    await logUsage(charge, 0, 'failure_no_charge');
    return { charged: false, ucCost: 0, cached: false };
  }
  if (isXCacheHit(charge.userId, charge.cacheKey)) {
    await logUsage(charge, 0, 'dedup_cache_hit');
    return { charged: false, ucCost: 0, cached: true };
  }

  const estimate = await estimateXOperationCost(charge.operationCode, charge.unitCount);
  const balance = await hasEnoughCredits(charge.userId, estimate.ucCost);
  if (!balance.ok) {
    return {
      charged: false,
      ucCost: estimate.ucCost,
      cached: false,
      error: {
        success: false,
        output: '',
        error: `insufficient_uc: Nincs elég UC-egyenleged ehhez az X-művelethez (szükséges: ${estimate.ucCost} UC, jelenlegi egyenleg: ${balance.balance} UC).`,
        details: { provider: 'x', requiredUc: estimate.ucCost, currentUc: balance.balance, operationCode: charge.operationCode },
      },
    };
  }

  await deductCredits(charge.userId, estimate.ucCost, charge.operationCode);
  markXCache(charge.userId, charge.cacheKey);
  await logUsage(charge, estimate.ucCost);
  return { charged: estimate.ucCost > 0, ucCost: estimate.ucCost, cached: false };
}

export async function annotateChargedResult(
  result: ConnectionCallResult,
  charge: Omit<XUsageCharge, 'success'>,
): Promise<ConnectionCallResult> {
  if (!result.success) {
    await chargeXUsage({ ...charge, success: false });
    return result;
  }
  const charged = await chargeXUsage({ ...charge, success: true });
  if (charged.error) return charged.error;
  return {
    ...result,
    details: {
      ...(result.details ?? {}),
      xBilling: {
        operationCode: charge.operationCode,
        unitCount: charge.unitCount,
        ucCost: charged.ucCost,
        charged: charged.charged,
        dedupCacheHit: charged.cached,
      },
    },
  };
}

export const UNAVAILABLE_OPERATIONS = [
  'like_post',
  'follow_user',
  'unfollow_user',
  'create_quote_post_action',
] as const;
