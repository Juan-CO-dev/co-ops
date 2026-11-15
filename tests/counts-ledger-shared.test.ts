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
  receivedUnitsWindow,
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

const line = (skuId: string, oz: number | string | null, created: string): DeliveryLedgerLine =>
  ({ id: `${skuId}-${created}`, skuId, resolvedOz: oz, receivedLevelLabel: null, receivedQtyAtLevel: null, createdUs: instantMicros(created), createdIso: created });

describe("received / consumed windows are (after, until]", () => {
  const lines = [
    line("a", 10, "2026-10-01T12:00:00Z"),           // exactly at `after` → out
    line("a", 5, "2026-10-01T12:00:00.000001Z"),      // 1 µs later → in
    line("a", 7, "2026-10-03T00:00:00Z"),             // exactly at `until` → in
    line("b", null, "2026-10-02T00:00:00Z"),          // null oz → b is advisory-null
    line("b", 3, "2026-10-02T00:00:00Z"),
    // B185: a line appended after the window opens counts, whatever its header's age (this one's
    // delivery was started on 2026-09-30, before the count; a receipt has no header instant here).
    line("c", 4, "2026-10-02T00:00:00Z"),
  ];
  it("sums in-window lines, starts every SKU at 0, and lets a null line taint its SKU", () => {
    expect(receivedOzWindow(lines, ["a", "b", "c", "d"], "2026-10-01T12:00:00+00:00", "2026-10-03T00:00:00+00:00"))
      .toEqual(new Map([["a", 12], ["b", null], ["c", 4], ["d", 0]]));
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
  // B186: delivery_date is an ET calendar date the receiver picks, so the anchor's day is its
  // ET operational date. A 9 PM ET count is stored as the NEXT UTC day.
  it("an evening ET count is not stale against the next morning's delivery", () => {
    const eveningCount = "2026-11-14T02:00:00+00:00"; // 2026-11-13 21:00 ET
    const nextMorning = (deliveryDate: string) => [{ createdUs: instantMicros("2026-11-14T13:00:00Z"), deliveryDate }];
    expect(retroEditStale(nextMorning("2026-11-14"), eveningCount)).toBe(false);
    expect(retroEditStale(nextMorning("2026-11-13"), eveningCount)).toBe(true); // back-dated onto the count's own ET day
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
    ...over,
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
  it("capture gap sets are narrowed to the consumer's own start", () => {
    const s = snap();
    expect([...salesGapDates(s, "2026-10-01")]).toEqual(["2026-10-03"]);
  });
});

describe("count-dimension received units (PR-C), from the shared receipt lines", () => {
  const chain = [
    { id: "case", label: "case", containsQty: 10, containsLevelId: "sleeve", containsMeasureUnit: null, displayOrdinal: 1 },
    { id: "sleeve", label: "sleeve", containsQty: 50, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 2 },
  ];
  const at = (created: string, level: string | null, qty: number | string | null): DeliveryLedgerLine =>
    ({ ...line("bags", null, created), receivedLevelLabel: level, receivedQtyAtLevel: qty });
  it("walks each line's level to leaf units and sums them", () => {
    expect(receivedUnitsWindow([at("2026-10-02T00:00:00Z", "case", 2), at("2026-10-03T00:00:00Z", " sleeve ", "4")], "bags", "2026-10-01T00:00:00Z", null, chain)).toBe(1200);
  });
  it("no chain → null; no line in the window → 0", () => {
    expect(receivedUnitsWindow([], "bags", "2026-10-01T00:00:00Z", null, null)).toBeNull();
    expect(receivedUnitsWindow([at("2026-09-01T00:00:00Z", "case", 1)], "bags", "2026-10-01T00:00:00Z", null, chain)).toBe(0);
  });
  // Audit B100: a receipt keeps the size of the pack it was received in.
  describe("each receipt is priced by the pack in force when it was written", () => {
    const pack = (casePer: number) => [
      { id: `case-${casePer}`, label: "case", containsQty: casePer, containsLevelId: `each-${casePer}`, containsMeasureUnit: null, displayOrdinal: 1 },
      { id: `each-${casePer}`, label: "bag", containsQty: 1, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 2 },
    ];
    const v1 = pack(100), v2 = pack(200); // the pack was edited at T1: a case went from 100 bags to 200
    const T1 = instantMicros("2026-10-05T00:00:00Z");
    const asOf = (l: DeliveryLedgerLine) => (l.createdUs < T1 ? v1 : v2);
    const before = at("2026-10-02T00:00:00Z", "case", 1);
    const after = at("2026-10-06T00:00:00Z", "case", 1);

    it("a pack edit after a receipt does not re-price that receipt", () => {
      // Through today's chain alone the two cases read 200 + 200.
      expect(receivedUnitsWindow([before, after], "bags", "2026-10-01T00:00:00Z", null, v2)).toBe(400);
      expect(receivedUnitsWindow([before, after], "bags", "2026-10-01T00:00:00Z", null, v2, asOf)).toBe(300);
    });
    it("a line before any version falls back to the live chain", () => {
      const none = (l: DeliveryLedgerLine) => (l.createdUs < T1 ? null : v2);
      expect(receivedUnitsWindow([before, after], "bags", "2026-10-01T00:00:00Z", null, v2, none)).toBe(400);
      expect(receivedUnitsWindow([before], "bags", "2026-10-01T00:00:00Z", null, v2, () => undefined)).toBe(200);
      expect(receivedUnitsWindow([before], "bags", "2026-10-01T00:00:00Z", null, v2, () => [])).toBe(200);
    });
    it("a label the pack of that day cannot walk falls back to the live chain, then to unknown", () => {
      const liveWithPallet = [{ id: "pallet", label: "pallet", containsQty: 10, containsLevelId: "case-200", containsMeasureUnit: null, displayOrdinal: 0 }, ...v2];
      const pallet = at("2026-10-02T00:00:00Z", "pallet", 1);
      expect(receivedUnitsWindow([pallet], "bags", "2026-10-01T00:00:00Z", null, liveWithPallet, asOf)).toBe(2000); // as before the fix
      expect(receivedUnitsWindow([at("2026-10-02T00:00:00Z", "drum", 1)], "bags", "2026-10-01T00:00:00Z", null, v2, asOf)).toBeNull();
    });
    it("no live chain is still unknown, whatever history says", () => {
      expect(receivedUnitsWindow([before], "bags", "2026-10-01T00:00:00Z", null, null, asOf)).toBeNull();
    });
    it("the window and the per-SKU filter are unchanged", () => {
      expect(receivedUnitsWindow([before, after], "bags", "2026-10-05T00:00:00Z", null, v2, asOf)).toBe(200);
      expect(receivedUnitsWindow([before, after], "cups", "2026-10-01T00:00:00Z", null, v2, asOf)).toBe(0);
    });
  });

  it("one level-less, qty-less or unwalkable line makes the whole term unknown", () => {
    for (const bad of [at("2026-10-02T00:00:00Z", null, 1), at("2026-10-02T00:00:00Z", "case", null), at("2026-10-02T00:00:00Z", "pallet", 1)]) {
      expect(receivedUnitsWindow([at("2026-10-02T00:00:00Z", "case", 1), bad], "bags", "2026-10-01T00:00:00Z", null, chain)).toBeNull();
    }
  });
});
