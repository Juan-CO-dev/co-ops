import { ok, summarizeSalesDay, type PoFact, type SalesOrderInput, type ShopV2Facts } from "@/lib/report-digests-v2-shared";

export const order = (id: string, over: Partial<SalesOrderInput> = {}): SalesOrderInput => ({
  snapshotId: id, salesChannel: "dine_in", deleted: false, voided: false, excessFood: false, selections: [], checks: [], ...over,
});
export const po = (id: string, vendorId: string, over: Partial<PoFact> = {}): PoFact => ({
  id, displayCode: `MEP-${id}`, vendorId, status: "placed", createdAt: "2026-10-07T12:00:00Z", confirmedAt: null, placedAt: null,
  placedByName: null, totalCents: 10000, unpricedLines: 0, ...over,
});

/** A clean v2 day (one shop): $100 net vs $80 last week, one PO placed, nothing else happening. */
export function v2Fixture(over: Partial<ShopV2Facts> = {}): ShopV2Facts {
  const sales = summarizeSalesDay("2026-10-07", [order("s", { checks: [{ checkGuid: "c", amountCents: 10000, voided: false, deleted: false }] })], [], false);
  return {
    lookahead: "2026-10-08",
    sales: ok({ today: sales, lastWeek: { ...sales, netCents: 8000 } }),
    catering: ok({ day: { orders: 1, completedCents: 5000, confirmedCents: 0 }, tomorrow: [] }),
    ordering: ok({ day: { placed: [po("p", "v", { placedAt: "2026-10-07T13:00:00Z", totalCents: 2500 })], unsent: [], missed: [], unverified: [], late: [] }, deliveries: { due: [], overdue: [], undated: [] }, cutoffsTomorrow: [], vendorNames: { v: "Vendor" } }),
    receiving: ok({ deliveries: [], credits: [], invoicesPendingReview: 0 }),
    inventory: ok({ walk: null, waste: [], storeRuns: { runs: 0, cents: 0, unknownCents: 0 } }),
    people: ok({ retrains: { assignedToday: 0, open: 0 } }),
    ...over,
  };
}

