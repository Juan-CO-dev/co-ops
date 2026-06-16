import type { RoleCode } from "@/lib/roles";

/** KH+ — matches the closing-finalize gate (the closer deposits). */
export const CASH_REPORT_BASE_LEVEL = 4;
/** $200 float kept in the register. */
export const DEFAULT_REGISTER_TARGET_CENTS = 20000;

/** US denomination units in cents, largest first (bills then coins). */
export const DENOMINATION_UNITS_CENTS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;

/** unit_cents (as string key) → quantity. */
export type Denominations = Record<string, number>;
export interface OnShiftEntry { userId: string | null; name: string }
export interface CashActor { userId: string; role: RoleCode; level: number }

export interface CashTotals { overShortCents: number; depositCents: number }

/**
 * The one money rule (spec §2). over/short = register − target; deposit =
 * projected + over/short. Pure + total; the server recomputes with this at
 * write time and never trusts client-sent totals.
 */
export function computeCashTotals(input: {
  projectedCents: number;
  registerCountCents: number;
  registerTargetCents: number;
}): CashTotals {
  const overShortCents = input.registerCountCents - input.registerTargetCents;
  const depositCents = input.projectedCents + overShortCents;
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

export interface CashReport {
  id: string;
  locationId: string;
  reportDate: string;
  projectedCents: number;
  registerCountCents: number;
  registerTargetCents: number;
  countMethod: "hand" | "denomination";
  denominations: Denominations | null;
  cashTipsCents: number;
  onShift: OnShiftEntry[];
  overShortCents: number;
  depositCents: number;
  overShortNote: string | null;
  signedBy: string;
  signedByName: string | null; // resolved by loader
  signedAt: string;
  createdAt: string;
}
