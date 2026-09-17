/**
 * V3-B §6 — what a scan does to the door's line list.
 *
 * Node environment, no DOM: `lib/scan-field-shared.ts` is the arithmetic half of
 * `ScanField`, extracted precisely so this file can exist (the repo has no component
 * tests). What stays untested here is DOM and network — the keystroke re-dispatch, the
 * camera sheet, the three fetches — and that boundary is deliberate, not an omission.
 */
import { describe, expect, it } from "vitest";

import { applyScanToLines, levelLabelFor, type ScanStepLine } from "@/lib/scan-field-shared";

interface Line extends ScanStepLine {
  key: string;
}

const line = (over: Partial<Line> = {}): Line => ({
  key: "k1",
  skuId: "sku-a",
  level: "",
  qty: "",
  expanded: false,
  confirmed: false,
  ...over,
});

describe("levelLabelFor", () => {
  it("case is the ROOT label and inner the one inside it (root → leaf)", () => {
    expect(levelLabelFor(["Case", "Bag", "Each"], "case")).toBe("Case");
    expect(levelLabelFor(["Case", "Bag", "Each"], "inner")).toBe("Bag");
  });

  it("a one-rung chain answers inner with that same rung, never with nothing", () => {
    expect(levelLabelFor(["Case"], "inner")).toBe("Case");
    expect(levelLabelFor(["Case"], "case")).toBe("Case");
  });

  it("no chain at all answers empty — the caller leaves the line's level alone", () => {
    expect(levelLabelFor([], "case")).toBe("");
    expect(levelLabelFor([], "inner")).toBe("");
  });
});

describe("applyScanToLines", () => {
  it("steps an empty quantity to 1 and opens the row at the scanned level", () => {
    const before = [line()];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Case");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "1", level: "Case", expanded: true, confirmed: false });
    expect(before[0]?.qty).toBe(""); // the input array is never mutated
  });

  it("steps 2 → 3 and 2.5 → 3.5 — the same arithmetic as the ± stepper", () => {
    expect(applyScanToLines([line({ qty: "2" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3");
    expect(applyScanToLines([line({ qty: "2.5" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3.5");
  });

  it("a non-numeric box restarts at 1 rather than writing NaN into a quantity", () => {
    expect(applyScanToLines([line({ qty: "abc" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("1");
  });

  it("drops a ✓ that predates the new count", () => {
    const { lines } = applyScanToLines([line({ qty: "4", confirmed: true })], { skuId: "sku-a" }, "Case");
    expect(lines[0]).toMatchObject({ qty: "5", confirmed: false });
  });

  it("a blank level label leaves a template-seeded level alone", () => {
    const { lines } = applyScanToLines([line({ level: "Case" })], { skuId: "sku-a" }, "");
    expect(lines[0]?.level).toBe("Case");
  });

  it("appends the provided row when the SKU is not on the delivery, and steps THAT row", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "7" })];
    const fresh = line({ key: "k2", skuId: "sku-b" });
    const { lines, index } = applyScanToLines(before, { skuId: "sku-b" }, "Bag", fresh);
    expect(lines).toHaveLength(2);
    expect(index).toBe(1);
    expect(lines[1]).toMatchObject({ key: "k2", skuId: "sku-b", qty: "1", level: "Bag", expanded: true });
    expect(lines[0]).toMatchObject({ key: "k1", qty: "7", expanded: false }); // untouched
  });

  it("an absent SKU with nothing to append leaves every line alone and reports -1", () => {
    const before = [line({ qty: "7", confirmed: true })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-z" }, "Case");
    expect(index).toBe(-1);
    expect(lines).toEqual(before);
  });

  it("touches ONLY the matched line", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1", level: "Case", confirmed: true }),
      line({ key: "k2", skuId: "sku-b", qty: "2", level: "Bag" }),
      line({ key: "k3", skuId: "sku-c", qty: "3", level: "Each", expanded: true }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-b" }, "Case");
    expect(index).toBe(1);
    expect(lines[0]).toEqual(before[0]);
    expect(lines[2]).toEqual(before[2]);
    expect(lines[1]).toMatchObject({ qty: "3", level: "Case", expanded: true });
  });

  it("steps the FIRST row carrying the SKU when the same item sits on two rows", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1" }),
      line({ key: "k2", skuId: "sku-a", qty: "9" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Case");
    expect(index).toBe(0);
    expect(lines[0]?.qty).toBe("2");
    expect(lines[1]?.qty).toBe("9");
  });
});
