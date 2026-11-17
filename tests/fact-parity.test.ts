// Item 2 PR 2b: the parity probe's pure half. sales_report_daily (0247) vs the facts, classes and
// refunds, including sales_refund_missing and an undated refund whose sale predates the window.
import { describe, expect, it } from "vitest";
import { compareDaily, factDaily, summarizeStale, type FactCheckClassRow, type FactRefundReadRow } from "@/lib/facts/parity-shared";

const chk = (d: string, cls: string, amount: number | null, gross: number | null = 100): FactCheckClassRow => ({
  business_date: d, order_guid: "o", check_guid: "c", sale_class: cls, amount_cents: amount, tax_cents: 10,
  gross_cents: gross, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, pre_refund_cents: 100 });
const ref = (order: string, refund: string | null, sales: number | null): FactRefundReadRow => ({
  order_business_date: order, refund_business_date: refund, refund_cents: 300, refund_tip_cents: 0, sales_refund_cents: sales });

describe("factDaily reproduces sales_report_daily's classes and refunds", () => {
  const out = factDaily([chk("2026-10-02", "sale", 100), chk("2026-10-02", "sale", null, null), chk("2026-10-02", "gift_card", 50)],
    [ref("2026-10-02", "2026-10-03", 300), ref("2026-10-02", "2026-10-03", null), ref("2026-09-20", null, null)], "2026-10-01", "2026-10-03");
  it("classes: unknown amounts counted, unknown accounting propagates null", () => {
    expect(out.classes).toEqual([
      { business_date: "2026-10-02", sale_class: "gift_card", checks: 1, amount_cents: 50, tax_cents: 10, gross_cents: 100,
        discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0, amount_missing: 0, tax_missing: 0 },
      { business_date: "2026-10-02", sale_class: "sale", checks: 2, amount_cents: 100, tax_cents: 20, gross_cents: null,
        discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 1, amount_missing: 1, tax_missing: 0 },
    ]);
  });
  it("refunds: dated on their refund day; an undated refund before the window is uncertainty on every window day", () => {
    expect(out.refunds).toEqual([
      { business_date: "2026-10-01", count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 },
      { business_date: "2026-10-02", count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 },
      { business_date: "2026-10-03", count: 0, refund_cents: 0, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 },
      { business_date: "2026-10-03", count: 2, refund_cents: 600, refund_tip_cents: 0, sales_refund_cents: null, sales_refund_missing: 1 },
    ]);
  });
  it("compareDaily: equal is empty whatever the tie order; a moved cent is named", () => {
    const report = { classes: [...out.classes].reverse(), refunds: [...out.refunds].reverse() };
    expect(compareDaily(report, out)).toEqual([]);
    const off = { ...report, classes: report.classes.map((c, i) => i === 0 ? { ...c, amount_cents: 101 } : c) };
    expect(compareDaily(off, out)).toEqual([expect.stringMatching(/^classes report-only .*101/), expect.stringMatching(/^classes facts-only /)]);
  });
  it("compareDaily ignores report keys the facts do not reproduce (tips, discounts, ezCater, coverage)", () => {
    expect(compareDaily({ ...out, tips: [1], ezcater: [2], captured_days: ["x"] } as never, out)).toEqual([]);
  });
});

it("summarizeStale groups the diff by shop and month for the backfill report", () => {
  expect(summarizeStale([{ day_location_id: "a", day_business_date: "2026-10-02" }, { day_location_id: "a", day_business_date: "2026-10-30" },
    { day_location_id: "b", day_business_date: "2026-09-01" }])).toEqual({ total: 3, byShopMonth: { "a 2026-10": 2, "b 2026-09": 1 } });
});
