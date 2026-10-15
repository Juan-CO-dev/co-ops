import { describe, expect, it } from "vitest";
import { CSV_BOM, SALES_EXPORT_COLUMNS, salesBreakdownRows, toCsv } from "@/lib/report-export-shared";
import type { BreakdownRow } from "@/lib/sales-reports-shared";

const period = { from: "2026-10-01", to: "2026-10-07" };
const shop = { id: "shop", code: "TEST", name: "Test shop" };
const row: BreakdownRow = Object.freeze({
  key: "item-1234", label: "Example", units: 6, checks: 2, cents: 1200, count: 3, amountMissing: 0,
  channel: "delivery", provider: "provider", saleClass: "ezcater_source", dow: 2, hour: 14,
});

describe("sales breakdown export projections", () => {
  it.each([
    ["items", { item_guid: "item-1234", item: "Example", units: 6, checks: 2 }],
    ["modifiers", { item_guid: "item-1234", modifier: "Example", units: 6, checks: 2 }],
    ["channels", { channel: "delivery", provider: "provider", source: "ezcater", counted: true, class: "ezcater_source", checks_or_orders: 2, sales: 1200, amount_missing: 0 }],
    ["heatmap", { weekday: 2, hour_et: 14, checks: 2, sales: 1200 }],
    ["discounts", { discount_name: "Example", applications: 3, checks: 2, amount: 1200, amount_missing: 0 }],
    ["servers", { server_first_name: "Example", server_ref: "1234", checks: 2, sales: 1200, amount_missing: 0, average_check: 600 }],
  ] as const)("preserves the %s column contract", (view, expected) => {
    const result = salesBreakdownRows(view, Object.freeze([row]), period, shop);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ period_start: period.from, period_end: period.to, ...expected });
    expect(salesBreakdownRows(view, [], period, shop)).toEqual([]);
  });

  it("preserves every distinct item in order through a 25,000-row CSV", () => {
    // URL-derived view, as in the route; exercise the real mapper and CSV writer.
    const view = new URL("https://example.test/?view=items").searchParams.get("view");
    if (view !== "items") throw new Error("invalid fixture view");
    const rows = Object.freeze(Array.from({ length: 25_000 }, (_, i) => Object.freeze({ ...row, key: `item-${i}`, label: `Item ${i}` })));
    const mapped = salesBreakdownRows(view, rows, period, shop);
    expect(mapped.map((r) => [r.item_guid, r.item])).toEqual(rows.map((r) => [r.key, r.label]));
    const csv = toCsv(SALES_EXPORT_COLUMNS.items, mapped);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(CSV_BOM.length).split("\r\n");
    expect(lines).toHaveLength(25_002);
    expect(lines.slice(1, -1).map((line) => line.split(",").slice(-4))).toEqual(rows.map((r) => [r.key, r.label, "6", "2"]));
  });
});
