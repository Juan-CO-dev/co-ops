/**
 * B9 — the pure window arithmetic the Counts read path runs over its once-per-render
 * ledgers (lib/counts-ledger-shared.ts). The end-to-end proof is
 * counts-onhand-equivalence.test.ts; these pin the edges that proof leans on.
 */
import { describe, expect, it } from "vitest";
import {
  consumedOzWindow,
  earliestInstant,
  instantMicros,
  receivedOzWindow,
  retroEditStale,
  salesDirectOz,
  salesGapDates,
  sliceSalesCoverage,
  type DeliveryLedgerLine,
  type SalesSnapshot,
} from "@/lib/counts-ledger-shared";

describe("instants compare as Postgres compares timestamptz", () => {
  it("is spelling-blind: Z, +00:00 and an offset are the same instant", () => {
    expect(instantMicros("2026-10-01T12:00:00Z")).toBe(instantMicros("2026-10-01T12:00:00+00:00"));
    expect(instantMicros("2026-10-01T08:00:00-04:00")).toBe(instantMicros("2026-10-01T12:00:00.000Z"));
  });
  it("keeps all six fractional digits (a JS Date keeps three)", () => {
    expect(instantMicros("2026-10-01T12:00:00.000001+00:00") - instantMicros("2026-10-01T12:00:00+00:00")).toBe(1);
    expect(instantMicros("2026-10-01T12:00:00.5+00:00")).toBeGreaterThan(instantMicros("2026-10-01T12:00:00.45+00:00"));
  });
  it("picks the earliest by value, returning the caller's own spelling", () => {
    expect(earliestInstant(["2026-10-02T00:00:00Z", "2026-10-01T23:59:59.999999+00:00"])).toBe("2026-10-01T23:59:59.999999+00:00");
    expect(earliestInstant([])).toBeNull();
  });
});

const line = (skuId: string, oz: number | string | null, created: string, header = created): DeliveryLedgerLine =>
  ({ id: `${skuId}-${created}`, skuId, resolvedOz: oz, receivedLevelLabel: null, receivedQtyAtLevel: null, createdUs: instantMicros(created), deliveryCreatedUs: instantMicros(header) });

describe("received / consumed windows are (after, until]", () => {
  const lines = [
    line("a", 10, "2026-10-01T12:00:00Z"),           // exactly at `after` → out
    line("a", 5, "2026-10-01T12:00:00.000001Z"),      // 1 µs later → in
    line("a", 7, "2026-10-03T00:00:00Z"),             // exactly at `until` → in
    line("b", null, "2026-10-02T00:00:00Z"),          // null oz → b is advisory-null
    line("b", 3, "2026-10-02T00:00:00Z"),
    line("c", 4, "2026-10-02T00:00:00Z", "2026-09-30T00:00:00Z"), // header written before the window → out
  ];
  it("sums in-window lines, starts every SKU at 0, and lets a null line taint its SKU", () => {
    expect(receivedOzWindow(lines, ["a", "b", "c", "d"], "2026-10-01T12:00:00+00:00", "2026-10-03T00:00:00+00:00"))
      .toEqual(new Map([["a", 12], ["b", null], ["c", 0], ["d", 0]]));
  });
  it("an open window runs to the end of the ledger", () => {
    expect(receivedOzWindow(lines, ["a"], "2026-10-01T12:00:00Z", null).get("a")).toBe(12);
  });
  it("consumption reads produced_at the same way", () => {
    const inputs = [{ skuId: "a", inputOz: "2.5", producedUs: instantMicros("2026-10-02T00:00:00Z") }, { skuId: "a", inputOz: 1, producedUs: instantMicros("2026-10-01T00:00:00Z") }];
    expect(consumedOzWindow(inputs, ["a"], "2026-10-01T00:00:00Z", null)).toEqual(new Map([["a", 2.5]]));
  });
});

describe("retro-edit staleness", () => {
  const headers = [{ createdUs: instantMicros("2026-10-09T12:00:00Z"), deliveryDate: "2026-10-07" }];
  it("a delivery written after the anchor but dated on/before it marks the anchor stale", () => {
    expect(retroEditStale(headers, "2026-10-08T13:30:00+00:00")).toBe(true);
    expect(retroEditStale(headers, "2026-10-06T13:30:00+00:00")).toBe(false); // dated after this anchor
    expect(retroEditStale(headers, "2026-10-10T00:00:00+00:00")).toBe(false); // written before this anchor
  });
});

describe("the one sales read, sliced", () => {
  const snap = (over: Partial<SalesSnapshot> = {}): SalesSnapshot => ({
    mode: "reconciled", locationId: "L", fromDate: "2026-10-01", end: "2026-10-10", today: "2026-10-10", openEtDate: "2026-10-10",
    rows: [
      { location_id: "L", business_date: "2026-10-01", sku_id: "a", direct_oz: 1, flattened_oz: 0 },
      { location_id: "L", business_date: "2026-10-05", sku_id: "a", direct_oz: 2, flattened_oz: 0 },
      { location_id: "L", business_date: "2026-10-09", sku_id: "a", direct_oz: 4, flattened_oz: 0 },
      { location_id: "X", business_date: "2026-10-05", sku_id: "a", direct_oz: 99, flattened_oz: 0 },
    ],
    coverage: { source: "capture", hasGaps: true, degraded: true, byLocation: { L: { hasGaps: true, degraded: true, missingDates: ["2026-10-03"], degradedDates: ["2026-10-08", "2026-10-02"] } } },
    legacyGaps: null, ...over,
  });
  it("a window clear of the gap sums its own days only", () => {
    const s = snap();
    expect(salesDirectOz(s, ["a"], "2026-10-04", "2026-10-09", salesGapDates(s, "2026-10-04"))).toEqual(new Map([["a", 2]]));
    expect(salesDirectOz(s, ["a"], "2026-10-04", null, salesGapDates(s, "2026-10-04"))).toEqual(new Map([["a", 6]]));
  });
  it("a window over a missing day is unknown, never zero", () => {
    const s = snap();
    expect(salesDirectOz(s, ["a"], "2026-10-01", "2026-10-05", salesGapDates(s, "2026-10-01"))).toEqual(new Map([["a", null]]));
  });
  it("a sliced disclosure keeps each date's own status and recomputes the flags", () => {
    expect(sliceSalesCoverage(snap().coverage, "2026-10-04", "2026-10-10")).toEqual({
      source: "capture", hasGaps: false, degraded: true,
      byLocation: { L: { hasGaps: false, degraded: true, missingDates: [], degradedDates: ["2026-10-08"] } },
    });
  });
  it("legacy gap sets are the probe's dates from the consumer's own start", () => {
    const s = snap({ mode: "legacy", legacyGaps: new Set(["2026-09-28", "2026-10-03"]) });
    expect([...salesGapDates(s, "2026-10-01")]).toEqual(["2026-10-03"]);
  });
});
