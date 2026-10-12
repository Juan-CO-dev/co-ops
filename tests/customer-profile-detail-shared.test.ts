import { describe, expect, it } from "vitest";
import { cateringSummary, monthlyVisits, orderHistory, shopSplit, type DetailOrder } from "@/lib/customers/profile-detail-shared";

const order = (overrides: Partial<DetailOrder> = {}): DetailOrder => ({ id: "a", customer_id: "person", business_date: "2026-10-01",
  channel: "takeout", total_cents: 1000, items: [], location_id: "shop-a", source_kind: "toast", ...overrides });

describe("customer detail projections", () => {
  it("uses twelve calendar months ending in the supplied ET month, including empty months", () => {
    // 00:30 UTC on November 1 is still October 31 ET.
    const months = monthlyVisits([order({ business_date: "2025-10-31" }), order({ business_date: "2025-11-01" }),
      order({ business_date: "2026-10-31" }), order({ business_date: "2026-11-01" })], "2026-10-31");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: "2025-11", visits: 1, spendCents: 1000 });
    expect(months[1]).toEqual({ month: "2025-12", visits: 0, spendCents: 0 });
    expect(months[11]).toEqual({ month: "2026-10", visits: 1, spendCents: 1000 });
    expect(monthlyVisits([], "2027-01-01")[0]!.month).toBe("2026-02");
  });
  it("keeps unknown month and shop totals unknown, with deterministic shop ties", () => {
    const orders = [order(), order({ total_cents: null }), order({ location_id: "shop-c" }), order({ location_id: "shop-b" })];
    expect(monthlyVisits(orders, "2026-10-12").at(-1)).toEqual({ month: "2026-10", visits: 4, spendCents: null });
    expect(shopSplit(orders)).toEqual([
      { locationId: "shop-a", visits: 2, spendCents: null, lastOrder: "2026-10-01" },
      { locationId: "shop-b", visits: 1, spendCents: 1000, lastOrder: "2026-10-01" },
      { locationId: "shop-c", visits: 1, spendCents: 1000, lastOrder: "2026-10-01" },
    ]);
  });
  it("sorts history by date and id, clamps pages and projects top-three items without extra fields", () => {
    const orders = [order({ id: "z", business_date: "2026-09-30" }), order({ id: "b", total_cents: null }),
      order({ id: "a", items: [{ name: "D", qty: 1 }, { name: "B", qty: 2 }, { name: "A", qty: 2 }, { name: "C", qty: 3 }] })];
    const first = orderHistory(orders, -1, 1);
    expect(first).toEqual({ rows: [{ date: "2026-10-01", locationId: "shop-a", channel: "takeout", source: "toast", totalCents: 1000,
      items: [{ name: "C", qty: 3 }, { name: "A", qty: 2 }, { name: "B", qty: 2 }], moreItems: 1 }], total: 3, page: 1, pages: 3 });
    expect(orderHistory(orders, 2, 1).rows[0]!.totalCents).toBeNull();
    expect(orderHistory(orders, 999, 1)).toMatchObject({ page: 3, rows: [{ date: "2026-09-30" }] });
    expect(orderHistory([], 5)).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
    expect(orders[0]!.id).toBe("z");
  });
  it("counts all three catering paths and propagates unknown spend", () => {
    expect(cateringSummary([order()])).toBeNull();
    expect(cateringSummary([order(), order({ channel: "catering" }), order({ source_kind: "catering" }),
      order({ source_kind: "ezcater", total_cents: null, business_date: "2026-10-02" })]))
      .toEqual({ orders: 3, spendCents: null, lastOrder: "2026-10-02" });
  });
});
