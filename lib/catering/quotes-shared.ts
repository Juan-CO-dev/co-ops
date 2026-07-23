/**
 * Quotes — PURE charge-stack math (no I/O, no server imports; unit-testable and
 * client-safe). Split from quotes.ts on 2026-07-23: the `server-only` guard on
 * lib/supabase-server.ts (PR #165) correctly refused to let the vitest spine
 * (PR #166) import the mixed quotes module — pure money math now lives here.
 * quotes.ts re-exports, so server consumers are unchanged.
 */

export interface ChargeRates {
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
}
export interface ChargeStack {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceChargeCents: number;
  gratuityCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

/** basis-points of an integer-cents base, rounded half-up to the nearest cent. Defense-in-depth:
 *  a non-finite or negative rate/base contributes 0 (never a negative or NaN charge) — the charge
 *  stack must never go negative regardless of the rate inputs (see A-H1). Valid rates are >=0, so
 *  this is a no-op for legitimate inputs. */
function bpsOf(baseCents: number, bps: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(bps) || bps <= 0 || baseCents <= 0) return 0;
  return Math.max(0, Math.round((baseCents * bps) / 10000));
}
/** A single line's frozen total: quantity x unit price, rounded to the nearest cent. */
export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * The one place quote money is computed. `lineTotals` are the per-line frozen totals
 * (already quantity x unit). Returns the full breakdown; the caller snapshots it + `rates`
 * onto the quote row so the math is immutable regardless of later pricing changes.
 */
export function computeChargeStack(
  lineTotals: number[],
  deliveryFeeCents: number,
  rates: ChargeRates,
): ChargeStack {
  const subtotalCents = lineTotals.reduce((s, n) => s + n, 0);
  const serviceChargeCents = bpsOf(subtotalCents, rates.serviceChargeBps);
  const gratuityCents = bpsOf(subtotalCents, rates.gratuityBps);
  const taxBase =
    subtotalCents +
    serviceChargeCents + // service charge is always in the tax base
    (rates.taxOnDelivery ? deliveryFeeCents : 0) +
    (rates.taxOnGratuity ? gratuityCents : 0);
  const taxCents = bpsOf(taxBase, rates.taxRateBps);
  const totalCents =
    subtotalCents + deliveryFeeCents + serviceChargeCents + gratuityCents + taxCents;
  const depositCents = bpsOf(totalCents, rates.depositPctBps);
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceChargeCents,
    gratuityCents,
    taxCents,
    totalCents,
    depositCents,
  };
}
