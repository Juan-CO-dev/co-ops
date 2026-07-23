/**
 * Cash — CLIENT-SAFE shared surface (pure money math + constants + types; no
 * I/O, no server imports). Split from cash.ts on 2026-07-23: the `server-only`
 * guard on lib/supabase-server.ts surfaced cash-client.tsx and
 * DenominationCounter.tsx runtime imports dragging the service-role module
 * (via cash.ts -> audit.ts) into the client graph (PR #165 CI catch — fifth
 * and final chain; verified last by transitive census).
 */

/** KH+ — matches the closing-finalize gate (the closer deposits). */
export const CASH_REPORT_BASE_LEVEL = 4;
/** $200 float kept in the register. */
export const DEFAULT_FLOAT_CENTS = 20000;

/** US denomination units in cents, largest first (bills then coins). */
export const DENOMINATION_UNITS_CENTS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;

/** unit_cents (as string key) -> quantity. */
export type Denominations = Record<string, number>;
export interface OnShiftEntry { userId: string | null; name: string }

export interface CashTotals { overShortCents: number; depositCents: number }

/**
 * The one money rule. deposit = drawer - float; over/short = deposit - projected
 * (negative = short, positive = over). Pure + total; the server recomputes with
 * this at write time and never trusts client-sent totals.
 */
export function computeCashTotals(input: {
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
}): CashTotals {
  const depositCents = input.drawerTotalCents - input.floatCents; // actual deposit (drawer minus float)
  const overShortCents = depositCents - input.projectedCents;     // over/short = actual - projected
  return { overShortCents, depositCents };
}

/** Sum a denomination map to cents. Ignores non-positive / unknown-unit entries. */
export function sumDenominations(denoms: Denominations): number {
  let total = 0;
  for (const unit of DENOMINATION_UNITS_CENTS) {
    const qty = denoms[String(unit)];
    if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
      total += unit * Math.floor(qty);
    }
  }
  return total;
}
