import { describe, expect, it } from "vitest";
import {
  SALES_EMPTY_KEY, channelView, heatLevel, heatmapGrid, mergeBreakdown, mergeEzcaterSummaries, pageRows, parseSalesCheckFilters,
  resolveSalesRange, salesDeltaPct, salesFilterParams, salesWindows, summarizeSales, toCheckDetail, inclusiveDays,
  type DailyRaw,
} from "@/lib/sales-reports-shared";

const TODAY = "2026-10-08";
const day = (over: Partial<DailyRaw> = {}): DailyRaw => ({ classes: [], tips: [], discounts: [], refunds: [], captured_days: [], ezcater: [], ...over });

describe("range wrapper: finished business days, 12 months reachable", () => {
  it("defaults to the seven finished days ending yesterday (today never mixed in)", () => {
    const r = resolveSalesRange({}, TODAY);
    expect(r).toMatchObject({ range: "last7", from: "2026-10-01", to: "2026-10-07", grain: "day", empty: false, todaySoFar: false });
    expect(r.previous).toEqual({ from: "2026-09-24", to: "2026-09-30" });
  });
  it("a custom range reaching today is clipped to yesterday; an explicit today is labelled today-so-far", () => {
    expect(resolveSalesRange({ range: "custom", from: "2026-10-01", to: "2026-10-08" }, TODAY).to).toBe("2026-10-07");
    expect(resolveSalesRange({ range: "today" }, TODAY)).toMatchObject({ from: TODAY, to: TODAY, todaySoFar: true });
  });
  it("this month on the 1st has no finished day: empty, never a fake window", () => {
    expect(resolveSalesRange({ range: "this_month" }, "2026-10-01")).toMatchObject({ empty: true });
  });
  it("last 12 months uses month grain and twelve calendar months", () => {
    const r = resolveSalesRange({ range: "last12m" }, TODAY);
    expect(r).toMatchObject({ grain: "month", from: "2025-11-01", to: "2026-10-07" });
    expect(r.previous).toEqual({ from: "2024-11-01", to: "2025-10-31" });
  });
  it("a wide custom range steps up the grain instead of dropping days; beyond 12 months it is shortened", () => {
    const wide = resolveSalesRange({ range: "custom", from: "2026-05-01", to: "2026-09-30" }, TODAY);
    expect(wide).toMatchObject({ grain: "week", from: "2026-05-01", shortened: false });
    const year = resolveSalesRange({ range: "custom", from: "2025-10-01", to: "2026-09-30" }, TODAY);
    expect(year).toMatchObject({ grain: "month", from: "2025-10-01", shortened: false });
    const tooWide = resolveSalesRange({ range: "custom", from: "2024-01-01", to: "2026-09-30" }, TODAY);
    expect(tooWide).toMatchObject({ grain: "month", from: "2025-10-01", shortened: true });
  });
  it("last month keeps its calendar meaning", () => {
    expect(resolveSalesRange({ range: "last_month" }, TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("windowing: every SQL call is at most 31 business days (the 8 s timeout lesson)", () => {
  it("12 months becomes disjoint <=31-day windows, newest first, covering every day once", () => {
    const w = salesWindows("2025-11-01", "2026-10-07");
    expect(w[0]!.to).toBe("2026-10-07");
    expect(w[w.length - 1]!.from).toBe("2025-11-01");
    for (const x of w) expect(inclusiveDays(x.from, x.to)).toBeLessThanOrEqual(31);
    const days = w.reduce((s, x) => s + inclusiveDays(x.from, x.to), 0);
    expect(days).toBe(inclusiveDays("2025-11-01", "2026-10-07"));
    for (let i = 1; i < w.length; i++) expect(w[i]!.to < w[i - 1]!.from).toBe(true);
  });
  it("invalid or inverted windows produce no calls", () => {
    expect(salesWindows("2026-10-07", "2026-10-01")).toEqual([]);
    expect(salesWindows("nope", "2026-10-01")).toEqual([]);
  });
});

describe("summary: only `sale` checks are sales; exclusions are named; ezCater counted once", () => {
  const raw = day({
    classes: [
      { business_date: "2026-10-06", sale_class: "sale", checks: 10, amount_cents: 15000, tax_cents: 900, amount_missing: 0 },
      { business_date: "2026-10-06", sale_class: "gift_card", checks: 2, amount_cents: 5000, tax_cents: 0, amount_missing: 0 },
      { business_date: "2026-10-06", sale_class: "ezcater_linked", checks: 1, amount_cents: 42000, tax_cents: 0, amount_missing: 0 },
      { business_date: "2026-10-06", sale_class: "void", checks: 3, amount_cents: 999, tax_cents: 0, amount_missing: 0 },
      { business_date: "2026-10-07", sale_class: "sale", checks: "4", amount_cents: "6000", tax_cents: "360", amount_missing: 0 },
    ],
    tips: [{ business_date: "2026-10-06", tip_cents: 1200 }],
    discounts: [{ business_date: "2026-10-06", count: 2, cents: 700 }],
    refunds: [{ business_date: "2026-10-07", count: 1, refund_cents: 500, refund_tip_cents: 0 }],
    captured_days: ["2026-10-06", "2026-10-07"],
    ezcater: [{ business_date: "2026-10-06", orders: 1, subtotal_cents: 40000, amount_missing: 0 }],
  });
  const { totals, buckets } = summarizeSales([raw], "2026-10-06", "2026-10-07", "day");
  it("gift cards are excluded from sales and shown as their own line", () => {
    expect(totals.toastNetCents).toBe(21000);
    expect(totals.giftCardCents).toBe(5000);
    expect(totals.giftCardChecks).toBe(2);
  });
  it("an ezCater-linked Toast ring is NOT a Toast sale; the ezCater order is the one revenue", () => {
    expect(totals.ezcaterLinkedCents).toBe(42000);
    expect(totals.ezcaterCents).toBe(40000);
    expect(totals.totalCents).toBe(21000 + 40000);
  });
  it("checks, average, tax, tips, discounts, refunds (by refund date) and coverage", () => {
    expect(totals).toMatchObject({ checks: 14, avgCheckCents: 1500, taxCents: 1260, tipCents: 1200, discountCents: 700, refundCents: 500, voidChecks: 3, coverage: "complete", coveredDays: 2, expectedDays: 2 });
    expect(buckets.map((b) => [b.key, b.totalCents])).toEqual([["2026-10-06", 55000], ["2026-10-07", 6000]]);
  });
  it("a day without a completed capture is a coverage gap, not a $0 day", () => {
    const r = summarizeSales([day({ captured_days: ["2026-10-06"] })], "2026-10-06", "2026-10-08", "day");
    expect(r.totals).toMatchObject({ coverage: "partial", coveredDays: 1, expectedDays: 3 });
    expect(r.buckets[2]).toMatchObject({ coverage: "missing" });
  });
  it("a missing amount marks the total partial and blocks the percentage", () => {
    const cur = summarizeSales([day({ classes: [{ business_date: "2026-10-06", sale_class: "sale", checks: 1, amount_cents: 100, tax_cents: 0, amount_missing: 1 }], captured_days: ["2026-10-06"] })], "2026-10-06", "2026-10-06", "day").totals;
    const prev = summarizeSales([day({ classes: [{ business_date: "2026-10-05", sale_class: "sale", checks: 1, amount_cents: 100, tax_cents: 0, amount_missing: 0 }], captured_days: ["2026-10-05"] })], "2026-10-05", "2026-10-05", "day").totals;
    expect(cur.amountMissing).toBe(1);
    expect(salesDeltaPct(cur, prev)).toBeNull();
    expect(salesDeltaPct({ ...cur, amountMissing: 0, totalCents: 150 }, prev)).toBe(50);
    expect(salesDeltaPct({ ...cur, amountMissing: 0 }, { ...prev, totalCents: 0 })).toBeNull();
    expect(salesDeltaPct({ ...cur, amountMissing: 0 }, { ...prev, coverage: "partial" })).toBeNull();
  });
  it("week and month buckets clip to the window (partial first/last bucket)", () => {
    const r = summarizeSales([], "2026-09-30", "2026-10-07", "week");
    expect(r.buckets.map((b) => [b.key, b.from, b.to, b.expectedDays])).toEqual([["2026-09-28", "2026-09-30", "2026-10-04", 5], ["2026-10-05", "2026-10-05", "2026-10-07", 3]]);
    const m = summarizeSales([], "2026-09-15", "2026-10-07", "month");
    expect(m.buckets.map((b) => [b.key, b.from, b.to])).toEqual([["2026-09-01", "2026-09-15", "2026-09-30"], ["2026-10-01", "2026-10-01", "2026-10-07"]]);
  });
  it("disjoint windows add, never double count", () => {
    const a = day({ classes: [{ business_date: "2026-10-01", sale_class: "sale", checks: 1, amount_cents: 100, tax_cents: 0, amount_missing: 0 }] });
    const b = day({ classes: [{ business_date: "2026-09-01", sale_class: "sale", checks: 2, amount_cents: 300, tax_cents: 0, amount_missing: 0 }] });
    expect(summarizeSales([a, b], "2026-09-01", "2026-10-01", "month").totals).toMatchObject({ toastNetCents: 400, checks: 3 });
  });
  it("a non-numeric amount from the database throws instead of becoming 0", () => {
    expect(() => summarizeSales([day({ classes: [{ business_date: "2026-10-06", sale_class: "sale", checks: 1, amount_cents: "abc", tax_cents: 0, amount_missing: 0 }] })], "2026-10-06", "2026-10-06", "day")).toThrow("sales_amount_invalid");
  });
});

describe("breakdowns", () => {
  it("discounts stay BY NAME: two names never lump; an unnamed discount is its own row", () => {
    const rows = mergeBreakdown("discount", [
      [{ key: "Employee Meal", label: "Employee Meal", count: 3, checks: 3, cents: 1500 }, { key: "Comp - Manager", label: "Comp - Manager", count: 1, checks: 1, cents: 900 }],
      [{ key: "Employee Meal", label: "Employee Meal", count: 2, checks: 2, cents: 1000 }, { key: "", label: null, count: 1, checks: 1, cents: 100 }],
    ]);
    expect(rows.map((r) => [r.key, r.count, r.cents])).toEqual([["Employee Meal", 5, 2500], ["Comp - Manager", 1, 900], ["", 1, 100]]);
  });
  it("servers merge on the ORDER server guid; the newest window's name wins; no name stays null", () => {
    const rows = mergeBreakdown("server", [
      [{ key: "g-1", label: "Ana", checks: 2, cents: 3000 }, { key: "g-2", label: null, checks: 1, cents: 500 }],
      [{ key: "g-1", label: "Anna", checks: 1, cents: 1000 }],
    ]);
    expect(rows).toMatchObject([{ key: "g-1", label: "Ana", checks: 3, cents: 4000 }, { key: "g-2", label: null }]);
  });
  it("items sort by units (GUID identity, not name); ties break on key", () => {
    const rows = mergeBreakdown("item", [[{ key: "b", label: "Sub", units: 2, checks: 2 }, { key: "a", label: "Sub", units: 2, checks: 2 }, { key: "c", label: "Chips", units: "5.5", checks: 3 }]]);
    expect(rows.map((r) => r.key)).toEqual(["c", "a", "b"]);
    expect(rows[0]!.units).toBe(5.5);
  });
  it("channels: gift cards and ezCater-linked rings are excluded; ezCater orders are counted once", () => {
    const rows = mergeBreakdown("channel", [[
      { key: "dine_in|house", channel: "dine_in", provider: "house", sale_class: "sale", checks: 5, cents: 5000 },
      { key: "online|gift_card", channel: "gift_card", provider: "gift_card", sale_class: "gift_card", checks: 1, cents: 2500 },
      { key: "catering|ezCater", channel: "catering", provider: "ezCater", sale_class: "ezcater_linked", checks: 1, cents: 30000 },
      { key: "catering|ezCater", channel: "catering", provider: "ezCater", sale_class: "ezcater_source", checks: 1, cents: 28000 },
    ]]);
    const v = channelView(rows);
    expect(v.includedCents).toBe(33000);
    expect(v.excluded.map((r) => r.saleClass).sort()).toEqual(["ezcater_linked", "gift_card"]);
  });
  it("heatmap: business weekday x ET hour, empty cells null (not 0), unknown hour apart", () => {
    const grid = heatmapGrid(mergeBreakdown("hour_weekday", [[
      { key: "1|12", dow: 1, hour: 12, checks: 4, cents: 8000 }, { key: "7|1", dow: 7, hour: 1, checks: 1, cents: 100 }, { key: "3|-1", dow: 3, hour: -1, checks: 2, cents: 50 },
    ], [{ key: "1|12", dow: 1, hour: 12, checks: 1, cents: 2000 }]]));
    expect(grid.cents[0]![12]).toBe(10000);
    expect(grid.checks[0]![12]).toBe(5);
    expect(grid.cents[6]![1]).toBe(100);
    expect(grid.cents[0]![13]).toBeNull();
    expect(grid.unknown).toEqual({ cents: 50, checks: 2 });
    expect(heatLevel(null, 10000)).toBe(0);
    expect(heatLevel(10000, 10000)).toBe(4);
    expect(heatLevel(100, 10000)).toBe(1);
  });
  it("pages a merged breakdown at 50 rows", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    expect(pageRows(rows, 0)).toMatchObject({ nextOffset: 50 });
    expect(pageRows(rows, 100)).toMatchObject({ nextOffset: null });
    expect(pageRows(rows, -5).rows[0]).toBe(0);
  });
  it("ezCater summaries add across windows; unknown statuses are ignored", () => {
    expect(mergeEzcaterSummaries([
      { orders: 2, subtotal_cents: 1000, amount_missing: 0, statuses: { matched: 1, not_rung_in_toast: 1 }, orphan_checks: 1, orphan_cents: 300 },
      { orders: "1", subtotal_cents: "500", amount_missing: 1, statuses: { amount_mismatch: 1, other: 4 }, orphan_checks: 0, orphan_cents: 0 },
    ])).toEqual({ orders: 3, subtotalCents: 1500, amountMissing: 1, statuses: { matched: 1, not_rung_in_toast: 1, amount_mismatch: 1 }, orphanChecks: 1, orphanCents: 300 });
  });
});

describe("check filters: a closed allowlist; invalid values are dropped, never sent", () => {
  it("parses and round-trips, with the empty-key sentinel", () => {
    const f = parseSalesCheckFilters({ channel: "third_party", provider: SALES_EMPTY_KEY, server: "abc-123", discount: "Employee Meal", dow: "3", hour: "-1" });
    expect(f).toEqual({ channel: "third_party", provider: "", server: "abc-123", discount: "Employee Meal", dow: 3, hour: -1 });
    expect(salesFilterParams(f)).toEqual({ channel: "third_party", provider: SALES_EMPTY_KEY, server: "abc-123", discount: "Employee Meal", dow: "3", hour: "-1" });
  });
  it("drops bad values", () => {
    expect(parseSalesCheckFilters({ channel: "gift_card", server: "x'; drop", dow: "8", hour: "24", discount: "a".repeat(121) })).toEqual({});
  });
});

describe("check detail projection", () => {
  it("orders the selection tree parent-first with depth and names item-level discounts", () => {
    const d = toCheckDetail({
      business_date: "2026-10-06", check_guid: "c1", sale_class: "sale", channel: "dine_in", amount_cents: "1200",
      discounts: [{ ordinal: 1, name: "Happy Hour", amount_cents: 200, selection_guid: "s1" }],
      service_charges: [], payments: [{ type: "CREDIT", amount_cents: 1300, tip_cents: null }],
      selections: [
        { selection_guid: "m1", parent_selection_guid: "s1", name: "Extra cheese", quantity: 1, voided: false },
        { selection_guid: "s1", parent_selection_guid: null, name: "Sub", quantity: 1, voided: false },
        { selection_guid: "s2", parent_selection_guid: null, name: "Chips", quantity: 2, voided: true },
      ],
    });
    expect(d.selections.map((s) => [s.name, s.depth])).toEqual([["Sub", 0], ["Extra cheese", 1], ["Chips", 0]]);
    expect(d.discounts[0]).toMatchObject({ name: "Happy Hour", itemName: "Sub", amountCents: 200 });
    expect(d.amountCents).toBe(1200);
    expect(d.payments[0]!.tipCents).toBeNull();
  });
});
