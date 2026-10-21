import { describe, expect, it } from 'vitest';
import { quoteTax, splitComponents, milliPercent, taxOn } from '../../src/shared/commerce/quote.js';

/** 18% GST on ₹1,000 exclusive, inter-state: IGST ₹180 → gross ₹1,180. */
describe('quoteTax (pure GST engine)', () => {
  it('quotes IGST for an inter-state exclusive line', () => {
    const q = quoteTax({
      amount: 1000,
      ratePercent: 18,
      cessPercent: 0,
      sameState: false,
      inclusive: false,
    });
    expect(q.components).toEqual([{ component: 'IGST', ratePercent: 18, amount: 180 }]);
    expect(q.netAmount).toBe(1000);
    expect(q.taxTotal).toBe(180);
    expect(q.grossAmount).toBe(1180);
  });

  it('quotes CGST+SGST halves for an intra-state exclusive line', () => {
    const q = quoteTax({
      amount: 1000,
      ratePercent: 18,
      cessPercent: 0,
      sameState: true,
      inclusive: false,
    });
    expect(q.components).toEqual([
      { component: 'CGST', ratePercent: 9, amount: 90 },
      { component: 'SGST', ratePercent: 9, amount: 90 },
    ]);
    expect(q.taxTotal).toBe(180);
    expect(q.grossAmount).toBe(1180);
  });

  it('adds a separate CESS component when the rate row carries one', () => {
    const q = quoteTax({
      amount: 1000,
      ratePercent: 28,
      cessPercent: 12,
      sameState: false,
      inclusive: false,
    });
    expect(q.components.map((c) => c.component)).toEqual(['IGST', 'CESS']);
    expect(q.taxTotal).toBe(400); // 280 IGST + 120 cess
    expect(q.grossAmount).toBe(1400);
  });

  it('back-computes the base from a tax-inclusive gross (inter-state)', () => {
    // ₹1,180 gross at 18%: base = 1180*100/118 = 1000, IGST = 180, net = 1000.
    const q = quoteTax({
      amount: 1180,
      ratePercent: 18,
      cessPercent: 0,
      sameState: false,
      inclusive: true,
    });
    expect(q.netAmount).toBe(1000);
    expect(q.taxTotal).toBe(180);
    expect(q.grossAmount).toBe(1180);
  });

  it('intra-state inclusive splits the gross into CGST/SGST halves', () => {
    // ₹1,180 gross at 18% intra: base 1000, CGST 90 + SGST 90.
    const q = quoteTax({
      amount: 1180,
      ratePercent: 18,
      cessPercent: 0,
      sameState: true,
      inclusive: true,
    });
    expect(q.components.map((c) => c.amount)).toEqual([90, 90]);
    expect(q.taxTotal).toBe(180);
  });

  it('keeps component sums reconciled to the tax total (inclusive, odd cents)', () => {
    const q = quoteTax({
      amount: 999.99,
      ratePercent: 18,
      cessPercent: 0,
      sameState: true,
      inclusive: true,
    });
    const sum = q.components.reduce((s, c) => s + c.amount, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(q.taxTotal * 100));
    expect(Math.round((q.netAmount + q.taxTotal) * 100)).toBe(Math.round(q.grossAmount * 100));
  });

  it('supports fractional rates like 5.5%', () => {
    const q = quoteTax({
      amount: 1000,
      ratePercent: 5.5,
      cessPercent: 0,
      sameState: false,
      inclusive: false,
    });
    expect(q.taxTotal).toBe(55);
    expect(q.grossAmount).toBe(1055);
  });

  it('applies half-up rounding to the rupee in exclusive mode', () => {
    const q = quoteTax({
      amount: 101.51,
      ratePercent: 18,
      cessPercent: 0,
      sameState: false,
      inclusive: false,
      rounding: 'half-up',
    });
    // Net 101.51 → 102; IGST 18.2718 → 18. Gross re-derived = 120.
    expect(q.netAmount).toBe(102);
    expect(q.taxTotal).toBe(18);
    expect(q.grossAmount).toBe(120);
  });

  it('applies rup (always-up) rounding in inclusive mode without moving the gross', () => {
    const q = quoteTax({
      amount: 251.13,
      ratePercent: 18,
      cessPercent: 0,
      sameState: false,
      inclusive: true,
      rounding: 'rup',
    });
    expect(q.grossAmount).toBe(251.13);
    expect(q.taxTotal).toBe(39); // 38.29 → 39
    expect(q.netAmount).toBe(251.13 - 39);
    expect(Math.round((q.netAmount + q.taxTotal) * 100)).toBe(Math.round(q.grossAmount * 100));
  });

  it('rejects negative and non-finite amounts', () => {
    expect(() =>
      quoteTax({ amount: -1, ratePercent: 18, cessPercent: 0, sameState: true, inclusive: false }),
    ).toThrow();
    expect(() =>
      quoteTax({
        amount: Number.NaN,
        ratePercent: 18,
        cessPercent: 0,
        sameState: true,
        inclusive: false,
      }),
    ).toThrow();
  });
});

describe('helpers', () => {
  it('splits rate 28 intra-state into 14+14 and keepscess separate', () => {
    expect(splitComponents(28, 12, true)).toEqual([
      { component: 'CGST', ratePercent: 14 },
      { component: 'SGST', ratePercent: 14 },
      { component: 'CESS', ratePercent: 12 },
    ]);
  });

  it('milliPercent and taxOn are exact on integers', () => {
    expect(milliPercent(5.5)).toBe(550);
    expect(taxOn(100000, 1800)).toBe(18000); // 18% of ₹1,000
  });
});
