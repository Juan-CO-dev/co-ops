// Item 2 PR 2b: the pure ORDER fact builder (plan r3 §2, §3; Astra r3 P2 #1 and #2).
import { describe, expect, it } from "vitest";
import {
  buildOrderDay, factQuarter, refundKept, FACT_BUILDER_VERSION, lineRevenueFromFacts,
  type OrderDaySource,
} from "@/lib/facts/order-facts-shared";
import { lineRevenue } from "@/lib/toast/line-prices-shared";

const LP = { v: 1, selections_present: true, heads: 1, uncaptured_heads: 0, mixed_heads: 0, net_cents: 900,
  source_complete: true, net_complete: true, gross_complete: true, receipt_line_complete: true } as const;
const ACC = { version: 1, gross_cents: 1000, discounts_comps_cents: 100, voids_cents: 0, service_charges_cents: 0, pre_refund_cents: 900 };

function order(guid: string, snapshot: string, units: unknown[] = []) {
  return { snapshot_id: snapshot, order_guid: guid, opened_at: "2026-11-01T05:15:00.000Z", paid_at: null, closed_at: null,
    promised_at: null, source: "In Store", revenue_center_guid: null, dining_option_guid: "dine", server_guid: "srv",
    deleted: false, voided: false, excess_food: false, third_party_provider_guid: null, third_party_provider_name: null,
    selection_units: units };
}
const priced = (sel: string, extra: Record<string, unknown> = {}) => ({ check_guid: "c1", selection_guid: sel,
  parent_selection_guid: null, item_guid: `item-${sel}`, name: "Sub", quantity: 1, voided: false, deleted: false,
  price_v: 1, net_cents: 900, gross_cents: 1000, receipt_line_cents: 1000, tax_cents: 90, tax_inclusion: "NOT_INCLUDED",
  selection_type: "NONE", deferred: false, ...extra });

function day(): OrderDaySource {
  return {
    locationId: "loc", businessDate: "2026-11-01",
    orders: [
      order("o-zero", "s-zero"),
      order("o-priced", "s-priced", [priced("h1"), priced("m1", { parent_selection_guid: "h1", net_cents: 0, gross_cents: 0, receipt_line_cents: 0 }),
        priced("sr", { selection_type: "SPECIAL_REQUEST", net_cents: 0 }), priced("gc", { deferred: true, net_cents: 2500 })]),
      order("o-old", "s-old", [{ check_guid: "c1", selection_guid: "x1", parent_selection_guid: null, item_guid: "i", name: "n",
        quantity: 2, voided: false, deleted: false }]),
    ],
    checks: [
      { snapshot_id: "s-priced", check_guid: "c1", amount_cents: 900, tax_cents: 90, total_cents: 990, voided: false, deleted: false,
        accounting: { ...ACC, line_prices: LP } },
      { snapshot_id: "s-old", check_guid: "c1", amount_cents: 1200, tax_cents: null, total_cents: null, voided: false, deleted: false,
        accounting: null },
    ],
    discounts: [
      { snapshot_id: "s-priced", check_guid: "c1", selection_guid: "h1", amount_cents: 100 },
      { snapshot_id: "s-priced", check_guid: "c1", selection_guid: null, amount_cents: 50 },
      { snapshot_id: "s-old", check_guid: "c1", selection_guid: "x1", amount_cents: null },
    ],
    payments: [],
  };
}

describe("buildOrderDay", () => {
  it("a zero-check order is in the manifest and has no check row (Astra r3 P2 #1)", () => {
    const out = buildOrderDay(day());
    expect(out.orders.map((o) => [o.order_guid, o.snapshot_id, o.check_count])).toEqual([
      ["o-old", "s-old", 1], ["o-priced", "s-priced", 1], ["o-zero", "s-zero", 0]]);
    expect(out.checks.map((c) => c.order_guid)).toEqual(["o-old", "o-priced"]);
  });

  it("copies the check's accounting and the snapshot's own line-price flags, never recomputing them", () => {
    const c = buildOrderDay(day()).checks.find((x) => x.order_guid === "o-priced")!;
    expect(c).toMatchObject({ amount_cents: 900, gross_cents: 1000, discounts_comps_cents: 100, pre_refund_cents: 900,
      line_price_state: "inline", line_net_cents: 900, source_complete: true, net_complete: true, gross_complete: true,
      receipt_line_complete: true, dining_option_guid: "dine", server_guid: "srv" });
  });

  it("an unpriced snapshot is 'not covered': completeness and line money are null, never 0 (Astra r3 P2 #2)", () => {
    const out = buildOrderDay(day());
    const c = out.checks.find((x) => x.order_guid === "o-old")!;
    expect(c).toMatchObject({ line_price_state: "unpriced", line_net_cents: null, source_complete: null, net_complete: null,
      gross_complete: null, receipt_line_complete: null, gross_cents: null });
    const l = out.lines.find((x) => x.order_guid === "o-old")!;
    expect(l).toMatchObject({ price_state: "not_covered", net_cents: null, gross_cents: null, receipt_line_cents: null,
      tax_cents: null, tax_inclusion: null, quantity: 2, discount_cents: null });
  });

  it("heads follow the one revenue-head rule: roots only, no SPECIAL_REQUEST, no deferred", () => {
    const heads = Object.fromEntries(buildOrderDay(day()).lines.filter((l) => l.order_guid === "o-priced")
      .map((l) => [l.selection_guid, l.is_head]));
    expect(heads).toEqual({ h1: true, m1: false, sr: false, gc: false });
  });

  it("line discounts sum the selection's own discounts; check-level ones stay off the lines", () => {
    const h1 = buildOrderDay(day()).lines.find((l) => l.selection_guid === "h1")!;
    expect(h1.discount_cents).toBe(100);
    expect(buildOrderDay(day()).lines.find((l) => l.selection_guid === "m1")!.discount_cents).toBe(0);
  });

  it("lineRevenue over the facts equals lineRevenue over the captured units (reused, never copied)", () => {
    const src = day();
    const out = buildOrderDay(src);
    for (const measure of ["net", "gross", "receipt_line"] as const) {
      const fromFacts = lineRevenueFromFacts(out, { captureCovered: true, saleClass: () => true }, measure);
      const direct = lineRevenue({ captureCovered: true,
        checks: [{ checkGuid: "c1", saleClass: true, linePrices: LP }],
        units: (src.orders[1]!.selection_units as never[]) }, measure);
      // o-old is unpriced, so the whole day is not covered; with o-priced alone it matches the direct read.
      expect(fromFacts.covered).toBe(false);
      expect(fromFacts.cents).toBeNull();
      const priceOnly = lineRevenueFromFacts({ ...out, checks: out.checks.filter((c) => c.order_guid === "o-priced"),
        lines: out.lines.filter((l) => l.order_guid === "o-priced") }, { captureCovered: true, saleClass: () => true }, measure);
      expect(priceOnly).toEqual(direct);
    }
  });

  it("is deterministic whatever order the source arrives in", () => {
    const a = buildOrderDay(day());
    const src = day();
    src.orders.reverse(); src.checks.reverse(); src.discounts.reverse();
    expect(buildOrderDay(src)).toEqual(a);
  });

  it("refuses a check or payment whose snapshot is not in the day's pointer set", () => {
    const src = day();
    src.checks.push({ ...src.checks[0]!, snapshot_id: "s-stray" });
    expect(() => buildOrderDay(src)).toThrow("fact_source_orphan");
  });

  it("carries the builder version", () => {
    expect(FACT_BUILDER_VERSION).toMatch(/^orders-v\d+$/);
  });
});

describe("refundKept: the 0239/0247 payment predicate, stored as a superset of every report read", () => {
  const base = { refund_business_date: null, sales_refund_cents: null, refund_amount_cents: null, refund_status: null };
  it.each([
    ["dated refund", { ...base, refund_business_date: "2026-11-03" }, true, true],
    ["undated with an amount", { ...base, refund_amount_cents: 500, sales_refund_cents: 400 }, true, true],
    ["undated FULL status", { ...base, refund_status: "FULL" }, true, true],
    ["undated, zero sales refund", { ...base, refund_amount_cents: 500, sales_refund_cents: 0 }, true, false],
    ["undated, unknown, accounted check", base, true, true],
    ["undated, unknown, legacy check", base, false, false],
  ] as const)("%s", (_n, p, accounted, kept) => {
    expect(refundKept(p, accounted)).toBe(kept);
  });

  it("refund rows keep their raw classification inputs and the order's business date", () => {
    const src = day();
    src.payments.push({ snapshot_id: "s-priced", check_guid: "c1", payment_guid: "p1", payment_status: "CAPTURED",
      refund_status: "PARTIAL", refund_amount_cents: 300, refund_tip_cents: 0, refund_business_date: "2026-11-04", sales_refund_cents: 300 });
    src.payments.push({ snapshot_id: "s-priced", check_guid: "c1", payment_guid: "p2", payment_status: "CAPTURED",
      refund_status: "NONE", refund_amount_cents: null, refund_tip_cents: null, refund_business_date: null, sales_refund_cents: 0 });
    const r = buildOrderDay(src).refunds;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ payment_guid: "p1", order_guid: "o-priced", refund_business_date: "2026-11-04",
      refund_cents: 300, sales_refund_cents: 300, check_accounting_present: true, dining_option_guid: "dine",
      order_voided: false, check_voided: false, excess_food: false });
  });
});

describe("factQuarter (plan r3 §2 item 5)", () => {
  it("labels both 01:15s on 2026-11-01 by their fold", () => {
    expect(factQuarter("2026-11-01T05:15:00.000Z")).toEqual({ quarter_start_at: "2026-11-01T05:15:00.000Z", wall_quarter: 5, fold: 0, et_date: "2026-11-01" });
    expect(factQuarter("2026-11-01T06:20:00.000Z")).toEqual({ quarter_start_at: "2026-11-01T06:15:00.000Z", wall_quarter: 5, fold: 1, et_date: "2026-11-01" });
  });
  it("skips the spring-forward gap on 2027-03-14 (02:xx never happens)", () => {
    expect(factQuarter("2027-03-14T06:59:00.000Z")).toMatchObject({ wall_quarter: 7, fold: 0 }); // 01:59 EST
    expect(factQuarter("2027-03-14T07:00:00.000Z")).toMatchObject({ wall_quarter: 12, fold: 0 }); // 03:00 EDT
  });
  it("keeps the ET calendar date apart from the business date", () => {
    expect(factQuarter("2026-11-03T04:30:00.000Z")).toMatchObject({ et_date: "2026-11-02", wall_quarter: 94 });
  });
  it("is null-safe", () => {
    expect(factQuarter(null)).toEqual({ quarter_start_at: null, wall_quarter: null, fold: null, et_date: null });
  });
});
