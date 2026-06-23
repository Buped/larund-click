import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKAGES,
  creditAmountsFromUsd,
  packageRealUsdCost,
  ucToVisibleCredits,
  visibleCreditsToUc,
} from '../credit-engine';

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
