/**
 * V3-B §6 — what a scan does to the door's line list, and when the wedge is armed.
 *
 * Node environment, no DOM: `lib/scan-field-shared.ts` is the arithmetic half of
 * `ScanField`, extracted precisely so this file can exist (the repo has no component
 * tests). What stays untested here is DOM and network — the camera sheet, the three
 * fetches — and that boundary is deliberate, not an omission.
 *
 * `isEditableTarget` is duck-typed against element-shaped literals for the same reason: it
 * is the one question the wedge listener asks of the live DOM, and Astra finding 1 turns on
 * getting its answer right, so it is pinned here rather than left to a browser.
 */
import { describe, expect, it } from "vitest";

import {
  applyScanToLines,
  isEditableTarget,
  levelLabelFor,
  type EditableProbe,
  type ScanStepLine,
} from "@/lib/scan-field-shared";

type Line = ScanStepLine;

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
    expect(applyScanToLines([line({ qty: "2", level: "Case" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3");
    expect(applyScanToLines([line({ qty: "2.5", level: "Case" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("3.5");
  });

  it("a non-numeric box restarts at 1 rather than writing NaN into a quantity", () => {
    expect(applyScanToLines([line({ qty: "abc" })], { skuId: "sku-a" }, "Case").lines[0]?.qty).toBe("1");
  });

  it("drops a ✓ that predates the new count", () => {
    const { lines } = applyScanToLines([line({ qty: "4", level: "Case", confirmed: true })], { skuId: "sku-a" }, "Case");
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
      line({ key: "k2", skuId: "sku-b", qty: "2", level: "Case" }),
      line({ key: "k3", skuId: "sku-c", qty: "3", level: "Each", expanded: true }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-b" }, "Case");
    expect(index).toBe(1);
    expect(lines[0]).toEqual(before[0]);
    expect(lines[2]).toEqual(before[2]);
    expect(lines[1]).toMatchObject({ qty: "3", level: "Case", expanded: true });
  });

  // ── Astra finding 2 · the level is part of the match key ───────────────────

  it("NEVER relabels a counted line: 2 cases + a scanned inner appends a bag row", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const fresh = line({ key: "k2", skuId: "sku-a" });
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag", fresh);
    expect(index).toBe(1);
    expect(lines[0]).toEqual(before[0]); // the two cases are still two cases
    expect(lines[1]).toMatchObject({ key: "k2", skuId: "sku-a", qty: "1", level: "Bag" });
  });

  it("steps the row already AT the scanned level rather than the first row of the SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" }),
      line({ key: "k2", skuId: "sku-a", qty: "4", level: "Bag" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(1);
    expect(lines[0]?.qty).toBe("2");
    expect(lines[1]?.qty).toBe("5");
  });

  it("prefers the row at the scanned level over an empty offered row of the same SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", level: "" }),
      line({ key: "k2", skuId: "sku-a", qty: "2", level: "Case" }),
    ];
    const { index } = applyScanToLines(before, { skuId: "sku-a" }, "Case");
    expect(index).toBe(1);
  });

  it("falls back to a row with NO level — stamping one overwrites nothing", () => {
    const before = [line({ key: "k1", skuId: "sku-a", level: "" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "1", level: "Bag" });
  });

  it("a SKU present only at another level and NO row to append leaves the list alone", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag");
    expect(index).toBe(-1);
    expect(lines).toEqual(before);
  });

  it("a levelless scan still steps the FIRST row carrying the SKU (legacy SKUs, no pack chain)", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1" }),
      line({ key: "k2", skuId: "sku-a", qty: "9" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "");
    expect(index).toBe(0);
    expect(lines[0]?.qty).toBe("2");
    expect(lines[1]?.qty).toBe("9");
  });

  // ── Astra finding 2 · the explicit pick binds to the ROW, not to the SKU ───

  it("an explicit lineKey steps THAT row, even when an earlier row carries the same SKU", () => {
    const before = [
      line({ key: "k1", skuId: "sku-a", qty: "1", level: "Case" }),
      line({ key: "k2", skuId: "sku-a", qty: "9", level: "Case" }),
    ];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Case", null, "k2");
    expect(index).toBe(1);
    expect(lines[0]?.qty).toBe("1");
    expect(lines[1]?.qty).toBe("10");
  });

  it("an explicit pick STAMPS the level on a row that has none", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "3", level: "" })];
    const { lines, index } = applyScanToLines(before, { skuId: "sku-a" }, "Bag", null, "k1");
    expect(index).toBe(0);
    expect(lines[0]).toMatchObject({ qty: "4", level: "Bag" });
  });

  it("an explicit pick of a row at a DIFFERENT level reports conflict and steps nothing", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "Bag", null, "k1");
    expect(res.conflict).toBe("level");
    expect(res.index).toBe(-1);
    expect(res.lines).toEqual(before);
  });

  it("a levelless scan on an explicit pick never conflicts — there is no level to disagree about", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2", level: "Case" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "", null, "k1");
    expect(res.conflict).toBeUndefined();
    expect(res.lines[0]).toMatchObject({ qty: "3", level: "Case" });
  });

  it("an explicit lineKey naming a row that is gone leaves the list alone", () => {
    const before = [line({ key: "k1", skuId: "sku-a", qty: "2" })];
    const res = applyScanToLines(before, { skuId: "sku-a" }, "Case", line({ key: "k9" }), "k-removed");
    expect(res.index).toBe(-1);
    expect(res.lines).toEqual(before);
  });
});

describe("isEditableTarget — when the wedge stands down (Astra finding 1)", () => {
  const el = (over: Partial<EditableProbe> = {}): EditableProbe => ({
    tagName: "DIV",
    getAttribute: () => null,
    parentElement: null,
    ...over,
  });

  it("an input, a textarea and a select are all editable", () => {
    expect(isEditableTarget(el({ tagName: "INPUT" }))).toBe(true);
    expect(isEditableTarget(el({ tagName: "textarea" }))).toBe(true);
    expect(isEditableTarget(el({ tagName: "SELECT" }))).toBe(true);
  });

  it("a contenteditable element is editable, by property or by attribute", () => {
    expect(isEditableTarget(el({ isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "" : null) }))).toBe(true);
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "true" : null) }))).toBe(true);
  });

  it("a child of a contenteditable is editable — the caret is inside it", () => {
    const host = el({ getAttribute: (n) => (n === "contenteditable" ? "true" : null) });
    const span = el({ tagName: "SPAN", parentElement: host });
    expect(isEditableTarget(span)).toBe(true);
  });

  it("contenteditable=\"false\" is NOT editable", () => {
    expect(isEditableTarget(el({ getAttribute: (n) => (n === "contenteditable" ? "false" : null) }))).toBe(false);
  });

  it("a button, a plain div and the body are not editable — this is where the wedge arms", () => {
    const body = el({ tagName: "BODY" });
    expect(isEditableTarget(body)).toBe(false);
    expect(isEditableTarget(el({ tagName: "BUTTON", parentElement: body }))).toBe(false);
    expect(isEditableTarget(el({ tagName: "DIV", parentElement: body }))).toBe(false);
  });

  it("null (no focus at all) is not editable", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it("a cyclic parent chain terminates instead of hanging the door", () => {
    const a: EditableProbe = { tagName: "DIV", getAttribute: () => null, parentElement: null };
    a.parentElement = a;
    expect(isEditableTarget(a)).toBe(false);
  });
});
