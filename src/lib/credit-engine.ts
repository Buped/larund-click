export const CREDIT_MARKUP_MULTIPLIER = 1.2;
export const OUTPUT_CREDITS_PER_USAGE_CREDIT = 10;

export type CreditSource =
  | `ai_model:${string}`
  | `x_api:${string}`
  | `web_search:${string}`
  | `connector:${string}`
  | string;

export interface CreditAmounts {
  usdCost: number;
  ucAmount: number;
  ocAmount: number;
}

export interface CreditPackageConfig {
  packageCode: 'free' | 'pro' | 'max';
  displayName: string;
  monthlyPriceUsd: number;
  monthlyOcAllowance: number;
  isActive: boolean;
}

export interface DeductCreditsInput {
  userId: string;
  usdCost: number;
  source: CreditSource;
  metadata?: Record<string, unknown>;
  relatedEntityId?: string;
}

export interface DeductCreditsResult extends CreditAmounts {
  deducted: boolean;
}

export const CREDIT_PACKAGES: CreditPackageConfig[] = [
  { packageCode: 'free', displayName: 'Free', monthlyPriceUsd: 0, monthlyOcAllowance: 25, isActive: true },
  { packageCode: 'pro', displayName: 'Pro', monthlyPriceUsd: 29, monthlyOcAllowance: 300, isActive: true },
  { packageCode: 'max', displayName: 'Max', monthlyPriceUsd: 99, monthlyOcAllowance: 1000, isActive: true },
];

export function creditAmountsFromUsd(usdCost: number): CreditAmounts {
  const usd = roundMoney(Math.max(0, Number.isFinite(usdCost) ? usdCost : 0));
  const ucAmount = roundCredits(usd * CREDIT_MARKUP_MULTIPLIER);
  const ocAmount = roundCredits(ucAmount * OUTPUT_CREDITS_PER_USAGE_CREDIT);
  return { usdCost: usd, ucAmount, ocAmount };
}

export function ucToVisibleCredits(ucAmount: number): number {
  return roundCredits(Math.max(0, Number(ucAmount) || 0) * OUTPUT_CREDITS_PER_USAGE_CREDIT);
}

export function visibleCreditsToUc(ocAmount: number): number {
  return roundCredits(Math.max(0, Number(ocAmount) || 0) / OUTPUT_CREDITS_PER_USAGE_CREDIT);
}

export function formatVisibleCredits(value: number): string {
  const rounded = roundCredits(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function packageRealUsdCost(pkg: CreditPackageConfig): number {
  return roundMoney(pkg.monthlyOcAllowance / (OUTPUT_CREDITS_PER_USAGE_CREDIT * CREDIT_MARKUP_MULTIPLIER));
}

export function packageByTier(tier?: string | null): CreditPackageConfig {
  const normalized = (tier ?? '').toLowerCase();
  if (normalized.includes('max') || normalized.includes('plus')) return CREDIT_PACKAGES[2];
  if (normalized.includes('pro') || normalized.includes('premium')) return CREDIT_PACKAGES[1];
  return CREDIT_PACKAGES[0];
}

export async function hasUnlimitedCredits(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const { isUserAdminForCredits } = await import('./supabase');
    return isUserAdminForCredits(userId);
  } catch {
    return false;
  }
}

export async function deductCredits(input: DeductCreditsInput): Promise<DeductCreditsResult> {
  const amounts = creditAmountsFromUsd(input.usdCost);
  if (!input.userId || amounts.usdCost <= 0 || amounts.ucAmount <= 0) {
    return { ...amounts, deducted: false };
  }
  if (await hasUnlimitedCredits(input.userId)) {
    return { ...amounts, deducted: false };
  }

  const { supabase } = await import('./supabase');
  const relatedEntityId = input.relatedEntityId ?? relatedIdFromMetadata(input.metadata);

  // Canonical deduction path: the `deduct_larund_credits` RPC decrements
  // user_credits.uc_balance and writes the credit_transactions row atomically.
  // Any failure here is surfaced loudly — silently swallowing it once let credit
  // deduction stay broken in production for months unnoticed.
  let rpcError: unknown = null;
  try {
    const { error } = await supabase.rpc('deduct_larund_credits', {
      p_user_id: input.userId,
      p_usd_cost: amounts.usdCost,
      p_uc_amount: amounts.ucAmount,
      p_oc_amount: amounts.ocAmount,
      p_source: input.source,
      p_related_entity_id: relatedEntityId,
      p_metadata: input.metadata ?? {},
    });
    if (!error) {
      return { ...amounts, deducted: true };
    }
    rpcError = error;
  } catch (e) {
    rpcError = e;
  }

  console.error(
    `Credit deduction failed (source=${input.source}, user=${input.userId}):`,
    rpcError instanceof Error ? rpcError.message : rpcError,
  );
  await logCreditTransaction(input, amounts, relatedEntityId, 'rpc_failed');
  return { ...amounts, deducted: false };
}

async function logCreditTransaction(
  input: DeductCreditsInput,
  amounts: CreditAmounts,
  relatedEntityId?: string,
  status = 'deducted',
): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('credit_transactions').insert({
    user_id: input.userId,
    source: input.source,
    usd_cost: amounts.usdCost,
    uc_amount: amounts.ucAmount,
    oc_amount: amounts.ocAmount,
    related_entity_id: relatedEntityId,
    metadata: { ...(input.metadata ?? {}), status },
  });
  if (error) {
    console.error(
      `Credit transaction log failed (source=${input.source}, status=${status}):`,
      error.message,
    );
  }
}

function relatedIdFromMetadata(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined;
  const value = metadata.relatedEntityId ?? metadata.messageId ?? metadata.postId ?? metadata.taskRunId;
  return typeof value === 'string' ? value : undefined;
}

function roundCredits(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
