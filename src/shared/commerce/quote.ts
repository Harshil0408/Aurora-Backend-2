/**
 * Pure GST quoting engine (Module 5) — no Prisma, no Express, no I/O.
 *
 * Both the admin preview endpoint and the future checkout (orders module)
 * call these functions; the caller resolves the effective TaxRate row from
 * the database and passes plain numbers in. All arithmetic runs on integer
 * paise so totals stay exact and component sums ALWAYS reconcile to the
 * tax total — invoice lines must match the paisa.
 *
 * Rounding modes (Module 5 commerce settings) apply to final money only,
 * never to the rate:
 * - 'none'    : keep paise precision (default).
 * - 'half-up' : round money to the nearest rupee.
 * - 'rup'     : Indian RUP convention — always round money up, never down.
 *
 * Inclusive vs exclusive pricing:
 * - exclusive: `amount` is the NET taxable base. Tax = base × rate; the
 *   buyer pays gross = base + tax. Rounding rounds the net and each tax
 *   component; gross is recomputed so net + tax == gross always holds.
 * - inclusive: `amount` is the GROSS the buyer pays — a fixed sticker price,
 *   rounding must never change it. The taxable base is back-computed
 *   (base = gross × 100 / (100 + rate + cess)); tax components round to the
 *   rupee and the NET absorbs any residual so gross == net + tax holds.
 */

export type TaxComponent = 'CGST' | 'SGST' | 'IGST' | 'CESS';

export interface TaxComponentQuote {
  component: TaxComponent;
  ratePercent: number;
  amount: number;
}

export interface TaxQuoteInput {
  /** Taxable (exclusive) or gross (inclusive) amount in rupees. */
  amount: number;
  /** Effective headline GST rate percent, e.g. 18 or 5.5. */
  ratePercent: number;
  /** Effective cess percent charged on top of the headline rate. */
  cessPercent: number;
  /** Intra-state ⇒ CGST+SGST split; inter-state ⇒ one IGST line. */
  sameState: boolean;
  /** true ⇒ `amount` is the tax-inclusive gross (sticker price). */
  inclusive: boolean;
  /** Commerce-settings rounding mode. Default 'none'. */
  rounding?: 'none' | 'half-up' | 'rup';
}

export interface TaxQuoteResult {
  /** What the buyer pays (rounding-invariant in inclusive mode). */
  grossAmount: number;
  /** The taxable base the seller declares. */
  netAmount: number;
  /** Sum of all component amounts — reconciles to the paisa. */
  taxTotal: number;
  components: TaxComponentQuote[];
}

/** Rupees (2-decimal safe) → integer paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Integer paise → rupees. */
export function toRupees(paise: number): number {
  return paise / 100;
}

/** Percent (e.g. 18, 5.5) → integer milli-percent (1800, 550). */
export function milliPercent(percent: number): number {
  return Math.round(percent * 100);
}

/** Tax paise on `basePaise` at a milli-percent rate. Exact to the paisa. */
export function taxOn(basePaise: number, rateMilli: number): number {
  return Math.round((basePaise * rateMilli) / 10000);
}

function roundPaiseToRupee(paise: number, mode: 'half-up' | 'rup'): number {
  if (mode === 'rup') return Math.ceil(paise / 100) * 100;
  return Math.floor(paise / 100 + 0.5) * 100;
}

/**
 * Split the headline rate into GST components. Intra-state: CGST/SGST each
 * carry HALF the headline. Inter-state: one IGST line with the FULL rate.
 * Cess (when > 0) is always its own component, charged in full.
 */
export function splitComponents(
  ratePercent: number,
  cessPercent: number,
  sameState: boolean,
): Array<{ component: TaxComponent; ratePercent: number }> {
  const list: Array<{ component: TaxComponent; ratePercent: number }> = [];
  if (sameState) {
    list.push({ component: 'CGST', ratePercent: ratePercent / 2 });
    list.push({ component: 'SGST', ratePercent: ratePercent / 2 });
  } else {
    list.push({ component: 'IGST', ratePercent });
  }
  if (cessPercent > 0) list.push({ component: 'CESS', ratePercent: cessPercent });
  return list;
}

/**
 * Quote tax for one order line. Exact integer-paise math; the caller has
 * already resolved the rate row (state override → 'ALL') and compared the
 * seller vs ship-to states.
 */
export function quoteTax(input: TaxQuoteInput): TaxQuoteResult {
  const rounding = input.rounding ?? 'none';
  const amountPaise = toPaise(input.amount);
  if (!Number.isFinite(input.amount) || amountPaise < 0) {
    throw new Error('Amount must be a finite, non-negative number');
  }

  const totalMilli = milliPercent(input.ratePercent) + milliPercent(input.cessPercent);

  // 1. Anchor the gross/net pair for the pricing direction.
  const grossPaise = input.inclusive ? amountPaise : amountPaise + taxOn(amountPaise, totalMilli);
  const netPaise = input.inclusive
    ? Math.round((grossPaise * 10000) / (10000 + totalMilli))
    : amountPaise;

  // 2. Component paise from the taxable base.
  const componentPaise = splitComponents(input.ratePercent, input.cessPercent, input.sameState).map(
    ({ component, ratePercent }) => ({
      component,
      ratePercent,
      paise: taxOn(netPaise, milliPercent(ratePercent)),
    }),
  );

  // 3. Apply rounding to final money.
  let taxTotalPaise = componentPaise.reduce((sum, c) => sum + c.paise, 0);
  let resultNetPaise = netPaise;
  let resultGrossPaise = grossPaise;
  if (rounding !== 'none') {
    const mode = rounding === 'rup' ? ('rup' as const) : ('half-up' as const);
    taxTotalPaise = componentPaise.reduce((sum, c) => sum + roundPaiseToRupee(c.paise, mode), 0);
    if (input.inclusive) {
      resultNetPaise = grossPaise - taxTotalPaise; // net absorbs the residual
      resultGrossPaise = grossPaise; // sticker stays fixed
    } else {
      resultNetPaise = roundPaiseToRupee(netPaise, mode);
      resultGrossPaise = resultNetPaise + taxTotalPaise; // re-derived
    }
  }

  // 4. Re-emit component amounts in rupees (paise-exact after rounding pass).
  const components: TaxComponentQuote[] = componentPaise.map(
    ({ component, ratePercent, paise }) => ({
      component,
      ratePercent,
      amount: toRupees(
        rounding === 'none'
          ? paise
          : roundPaiseToRupee(paise, rounding === 'rup' ? 'rup' : 'half-up'),
      ),
    }),
  );

  return {
    grossAmount: toRupees(resultGrossPaise),
    netAmount: toRupees(resultNetPaise),
    taxTotal: toRupees(taxTotalPaise),
    components,
  };
}
