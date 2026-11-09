/** Pure capture top-item aggregation and pace/date helpers. */
import { describe, it, expect } from "vitest";
import {
  addDaysYmd,
  pctDelta,
  sameWeekdayBaselineDates,
  topItemsForDay,
  type SalesEventRow,
} from "@/lib/midshift-sales-shared";

const row = (over: Partial<SalesEventRow>): SalesEventRow => ({
  business_date: "2026-07-30",
  check_guid: "chk1",
  selection_guid: "sel1",
  parent_selection_guid: null,
  item_name: "Teamster",
  quantity: 1,
  price_cents: 1200,
  voided: false,
  snapshot_version: 1,
  ...over,
});

describe("topItemsForDay", () => {
  it("counts top-level items by quantity; modifiers excluded", () => {
    const out = topItemsForDay(
      [
        row({}),
        row({ check_guid: "c2", selection_guid: "s2", quantity: 2 }),
        row({ check_guid: "c2", selection_guid: "s3", item_name: "Extra Mayo", parent_selection_guid: "s2" }),
        row({ check_guid: "c3", selection_guid: "s4", item_name: "Crunchy Boi" }),
      ],
      3,
    );
    expect(out[0]).toEqual({ name: "Teamster", qty: 3 });
    expect(out[1]).toEqual({ name: "Crunchy Boi", qty: 1 });
    expect(out.find((i) => i.name === "Extra Mayo")).toBeUndefined();
  });
});

describe("date helpers", () => {
  it("addDaysYmd crosses month/year boundaries", () => {
    expect(addDaysYmd("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysYmd("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("sameWeekdayBaselineDates walks back in 7-day steps", () => {
    expect(sameWeekdayBaselineDates("2026-07-31", 4)).toEqual([
      "2026-07-24",
      "2026-07-17",
      "2026-07-10",
      "2026-07-03",
    ]);
  });
});

describe("pctDelta", () => {
  it("computes whole-percent delta", () => {
    expect(pctDelta(1120, 1000)).toBe(12);
    expect(pctDelta(920, 1000)).toBe(-8);
  });
  it("null on a zero baseline (no fabricated comparison)", () => {
    expect(pctDelta(500, 0)).toBeNull();
  });
});
