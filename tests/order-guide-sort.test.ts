import { describe, expect, it } from "vitest";
import { compareByGuide, groupByGuideSection, NOT_ON_GUIDE } from "@/lib/order-guide-sort";

const L = (name: string, position: number | null, section: string | null) => ({ name, position, section });

describe("compareByGuide", () => {
  it("sorts by position ascending, nulls last, then name", () => {
    const rows = [L("Zucchini", null, null), L("Arugula", 2001, "Produce"), L("Eggs", 1001, "Dairy"), L("Basil", null, null)];
    expect([...rows].sort(compareByGuide).map((r) => r.name)).toEqual(["Eggs", "Arugula", "Basil", "Zucchini"]);
  });
  it("ties on position fall back to name", () => {
    expect([L("B", 5, "S"), L("A", 5, "S")].sort(compareByGuide).map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("groupByGuideSection", () => {
  it("emits headers in first-seen order after sorting, with not-on-guide last", () => {
    const rows = [L("Zucchini", null, null), L("Arugula", 2001, "Produce"), L("Eggs", 1001, "Dairy"), L("Milk", 1002, "Dairy")];
    const groups = groupByGuideSection(rows);
    expect(groups.map((g) => g.section)).toEqual(["Dairy", "Produce", NOT_ON_GUIDE]);
    expect(groups.map((g) => g.rows.map((r) => r.name))).toEqual([["Eggs", "Milk"], ["Arugula"], ["Zucchini"]]);
  });
  it("suppresses the header when not-on-guide is the only group", () => {
    const groups = groupByGuideSection([L("B", null, null), L("A", null, null)]);
    expect(groups).toEqual([{ section: null, rows: [L("A", null, null), L("B", null, null)] }]);
  });
  it("returns no groups for no rows", () => {
    expect(groupByGuideSection([])).toEqual([]);
  });
});
