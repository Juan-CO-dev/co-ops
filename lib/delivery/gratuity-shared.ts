/**
 * Catering delivery (D1) — the recorded driver / crew split of a quote's gratuity (plan r6 section 4.5; Juan's
 * decision 4: 10% to the driver, 90% to the shop crew). Zero I/O. Client-safe.
 *
 * RECORDED ONLY. Nothing pays, pools, exports to payroll or adjusts a paycheck from these figures, and no payroll
 * behaviour may be built on them: THE PAYROLL AND LEGAL TREATMENT OF THE DRIVER'S SHARE IS UNVERIFIED (the driver works
 * for the courier, not for us). Confirm with payroll before paying anything from this figure.
 *
 * `splitGratuity` is the SQL function `delivery_gratuity_split` (0356); both run
 * tests/fixtures/delivery/gratuity-split-cases.json. Integers only, round half up, and the parts sum to the whole.
 *
 * ONE allocation per ORDER: the chain is keyed by the lead, and the HEAD (the row nothing supersedes) is the order's
 * allocation. Totals use heads only. A `void` head or a 0-cent head allocates nothing.
 */
import type { DeliveryGratuitySplit } from "./types-shared";

export function splitGratuity(gratuityCents: number, driverBps: number): { driverCents: number; crewCents: number } {
  if (!Number.isSafeInteger(gratuityCents) || gratuityCents < 0 || !Number.isSafeInteger(driverBps) || driverBps < 0 || driverBps > 10000) {
    throw new RangeError("bad_gratuity");
  }
  // gratuityCents is a Postgres integer (< 2^31) and driverBps <= 10000, so the product stays far inside 2^53.
  const driverCents = Math.floor((gratuityCents * driverBps + 5000) / 10000);
  return { driverCents, crewCents: gratuityCents - driverCents };
}

/** The head of an order's chain: the row nothing supersedes. Null when the order has no row. */
export function splitHead(rows: readonly DeliveryGratuitySplit[]): DeliveryGratuitySplit | null {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => id !== null));
  return rows.find((r) => !superseded.has(r.id)) ?? null;
}

export interface GratuityAllocation { jobId: string; gratuityCents: number; driverBps: number; driverCents: number; crewCents: number }
/** What the order allocates NOW, from its head. Null = nothing (no row, a void, or a 0-cent split). */
export function allocationOf(head: DeliveryGratuitySplit | null): GratuityAllocation | null {
  if (!head || head.kind !== "split" || head.jobId === null || head.gratuityCents === 0) return null;
  return { jobId: head.jobId, gratuityCents: head.gratuityCents, driverBps: head.driverBps, driverCents: head.driverCents, crewCents: head.crewCents };
}
