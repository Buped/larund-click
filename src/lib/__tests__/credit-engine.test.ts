import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREDIT_PACKAGES,
  creditAmountsFromUsd,
  deductCredits,
  hasUnlimitedCredits,
  packageRealUsdCost,
  ucToVisibleCredits,
  visibleCreditsToUc,
} from '../credit-engine';

const isUserAdminForCreditsMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  isUserAdminForCredits: isUserAdminForCreditsMock,
  supabase: {
    rpc: rpcMock,
    from: () => ({ insert: insertMock }),
  },
}));

beforeEach(() => {
  isUserAdminForCreditsMock.mockReset();
  rpcMock.mockReset();
  insertMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
  insertMock.mockResolvedValue({ error: null });
});

describe('credit engine formulas', () => {
  it('converts real USD cost to UC and visible credits', () => {
    expect(creditAmountsFromUsd(1)).toEqual({
      usdCost: 1,
      ucAmount: 1.2,
      ocAmount: 12,
    });
  });

  it('converts between legacy UC storage and visible credits', () => {
    expect(ucToVisibleCredits(2.5)).toBe(25);
    expect(visibleCreditsToUc(300)).toBe(30);
  });

  it('keeps package economics aligned with the pricing table', () => {
    expect(CREDIT_PACKAGES.map((pkg) => pkg.monthlyOcAllowance)).toEqual([25, 300, 1000]);
    expect(CREDIT_PACKAGES.map(packageRealUsdCost)).toEqual([2.083333, 25, 83.333333]);
  });
});

describe('admin credit bypass', () => {
  it('treats admins as unlimited and skips deduction RPCs', async () => {
    isUserAdminForCreditsMock.mockResolvedValue(true);

    await expect(hasUnlimitedCredits('admin-user')).resolves.toBe(true);
    const result = await deductCredits({ userId: 'admin-user', usdCost: 1, source: 'ai_model:test' });

    expect(result.deducted).toBe(false);
    expect(result.ucAmount).toBe(1.2);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('keeps normal users on the existing deduction path', async () => {
    isUserAdminForCreditsMock.mockResolvedValue(false);

    const result = await deductCredits({ userId: 'normal-user', usdCost: 1, source: 'ai_model:test' });

    expect(result.deducted).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      'deduct_larund_credits',
      expect.objectContaining({
        p_user_id: 'normal-user',
        p_usd_cost: 1,
        p_uc_amount: 1.2,
        p_oc_amount: 12,
        p_source: 'ai_model:test',
      }),
    );
    // On success the RPC writes the transaction row itself — no client-side insert.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('does not silently swallow a failed deduction RPC', async () => {
    isUserAdminForCreditsMock.mockResolvedValue(false);
    rpcMock.mockResolvedValue({ error: { message: 'function does not exist' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await deductCredits({ userId: 'normal-user', usdCost: 1, source: 'ai_model:test' });

    expect(result.deducted).toBe(false);
    // Failure must be visible, not swallowed.
    expect(errorSpy).toHaveBeenCalled();
    // And an rpc_failed transaction row is recorded for observability.
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'normal-user',
        source: 'ai_model:test',
        metadata: expect.objectContaining({ status: 'rpc_failed' }),
      }),
    );

    errorSpy.mockRestore();
  });
});
