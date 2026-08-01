/**
 * Mid-shift sales pulse — pins the pure aggregation math (council 2026-07-31).
 * The load-bearing semantics: latest-snapshot-version wins; voided latest
 * versions excluded everywhere; price_cents is EXTENDED (never × quantity);
 * modifiers count in net $ but not in top items.
 */
import { describe, it, expect } from "vitest";
import {
  addDaysYmd,
  aggregateDaySales,
  pctDelta,
  reduceLatestSelections,
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

describe("reduceLatestSelections", () => {
  it("keeps only the highest snapshot_version per (check, selection)", () => {
    const out = reduceLatestSelections([
      row({ snapshot_version: 1, price_cents: 1200 }),
      row({ snapshot_version: 2, price_cents: 1300 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.price_cents).toBe(1300);
  });

  it("distinct selections both survive", () => {
    const out = reduceLatestSelections([row({}), row({ selection_guid: "sel2" })]);
    expect(out).toHaveLength(2);
  });
});

describe("aggregateDaySales", () => {
  it("sums EXTENDED price_cents (never multiplies by quantity)", () => {
    // quantity 2 with extended price 2400 — the correct net is 2400, not 4800.
    const agg = aggregateDaySales("2026-07-30", [row({ quantity: 2, price_cents: 2400 })]);
    expect(agg.netCents).toBe(2400);
  });

  it("a void-revision (latest version voided) removes the line AND its check", () => {
    const agg = aggregateDaySales("2026-07-30", [
      row({ snapshot_version: 1, voided: false }),
      row({ snapshot_version: 2, voided: true }),
    ]);
    expect(agg.netCents).toBe(0);
    expect(agg.checks).toBe(0);
    expect(agg.avgTicketCents).toBeNull();
  });

  it("checks = distinct check_guids with a live selection; avg ticket derives", () => {
    const agg = aggregateDaySales("2026-07-30", [
      row({}),
      row({ check_guid: "chk2", selection_guid: "s2", price_cents: 800 }),
      row({ check_guid: "chk2", selection_guid: "s3", price_cents: 200, parent_selection_guid: "s2" }),
    ]);
    expect(agg.netCents).toBe(2200); // 1200 + 800 + 200 (modifier upcharge counts)
    expect(agg.checks).toBe(2);
    expect(agg.avgTicketCents).toBe(1100);
  });

  it("null price_cents contributes 0 but the check still counts", () => {
    const agg = aggregateDaySales("2026-07-30", [row({ price_cents: null })]);
    expect(agg.netCents).toBe(0);
    expect(agg.checks).toBe(1);
  });
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
