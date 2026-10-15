/** Catalog Phase 2b — the sentence pack model: chain ⇄ "1 case holds 6 bag; each bag weighs 5 lb". */
import { describe, expect, it } from "vitest";
import { leafUnitChoices, levelsFromSentence, sentenceFromLevels, type SentenceDraft } from "@/lib/catalog/pack-sentence-shared";

const chain = [
  { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  { id: "c", label: "case", containsQty: 6, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
];
const measureLabels = new Set(["oz", "lb", "each", "gal"]);

describe("sentenceFromLevels", () => {
  it("walks root → leaf by pointer (never by ordinal)", () => {
    expect(sentenceFromLevels(chain)).toEqual({ containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "6" }], leafQty: "5", leafUnit: "lb" });
  });
  it("a one-level chain and an empty chain", () => {
    expect(sentenceFromLevels([{ id: "t", label: "tub", containsQty: 30, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }]))
      .toEqual({ containers: [{ label: "tub", qty: "1" }], leafQty: "30", leafUnit: "lb" });
    expect(sentenceFromLevels([])).toBeNull();
  });
});

describe("a chain the sentence cannot say reads back as null (never a guess)", () => {
  it("a detached level (two roots), a cycle, and a leaf with no measure unit", () => {
    expect(sentenceFromLevels([...chain, { id: "x", label: "box", containsQty: 2, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 2 }])).toBeNull();
    expect(sentenceFromLevels([
      { id: "a", label: "a", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "b", containsQty: 2, containsLevelId: "a", containsMeasureUnit: null, displayOrdinal: 1 },
    ])).toBeNull();
    expect(sentenceFromLevels([{ id: "t", label: "tub", containsQty: 1, containsLevelId: null, containsMeasureUnit: null, displayOrdinal: 0 }])).toBeNull();
  });
  it("round-trips: the live chain as a sentence and back is the same chain, root first", () => {
    const draft = sentenceFromLevels(chain)!;
    expect(levelsFromSentence(draft, measureLabels)).toEqual({ ok: true, levels: [
      { label: "case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null },
      { label: "bag", containsQty: 5, containsIndex: null, containsMeasureUnit: "lb" },
    ] });
  });
});

describe("levelsFromSentence", () => {
  const ok: SentenceDraft = { containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "4" }], leafQty: "10", leafUnit: "lb" };
  it("builds the index-linked chain the writer takes, root first", () => {
    expect(levelsFromSentence(ok, measureLabels)).toEqual({ ok: true, levels: [
      { label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null },
      { label: "bag", containsQty: 10, containsIndex: null, containsMeasureUnit: "lb" },
    ] });
  });
  it("refuses, by name: empty label, duplicate label, a measure word as a container, a bad number, no unit", () => {
    expect(levelsFromSentence({ ...ok, containers: [{ label: " ", qty: "1" }] }, measureLabels)).toEqual({ ok: false, error: "empty_label", index: 0 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "case", qty: "1" }, { label: "Case", qty: "2" }] }, measureLabels)).toEqual({ ok: false, error: "duplicate_label", index: 1 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "lb", qty: "1" }] }, measureLabels)).toEqual({ ok: false, error: "label_is_measure_unit", index: 0 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "case", qty: "1" }, { label: "bag", qty: "0" }] }, measureLabels)).toEqual({ ok: false, error: "bad_qty", index: 1 });
    expect(levelsFromSentence({ ...ok, leafQty: "x" }, measureLabels)).toEqual({ ok: false, error: "bad_qty", index: 1 });
    expect(levelsFromSentence({ ...ok, leafUnit: "" }, measureLabels)).toEqual({ ok: false, error: "no_leaf_unit", index: 1 });
  });
  it("matches the writer (chunk-1 review P3c): a unit word in ANY case is not a container; the leaf must be a registered unit", () => {
    expect(levelsFromSentence({ ...ok, containers: [{ label: "LB", qty: "1" }] }, measureLabels)).toEqual({ ok: false, error: "label_is_measure_unit", index: 0 });
    expect(levelsFromSentence({ ...ok, containers: [{ label: "case", qty: "1" }, { label: "Oz", qty: "4" }] }, measureLabels)).toEqual({ ok: false, error: "label_is_measure_unit", index: 1 });
    expect(levelsFromSentence({ ...ok, leafUnit: "kg" }, measureLabels)).toEqual({ ok: false, error: "unknown_measure", index: 1 });
    expect(levelsFromSentence({ ...ok, leafUnit: "LB" }, measureLabels)).toEqual({ ok: false, error: "unknown_measure", index: 1 });
  });
});

describe("leafUnitChoices", () => {
  const units = [
    { label: "oz", dimension: "weight" as const }, { label: "lb", dimension: "weight" as const },
    { label: "each", dimension: "count" as const }, { label: "gal", dimension: "volume" as const },
  ];
  it("a raw item ends in a weight — unless its current leaf already uses the per-piece weight", () => {
    expect(leafUnitChoices(units, "raw", null)).toEqual(["oz", "lb"]);
    expect(leafUnitChoices(units, "raw", "each")).toEqual(["oz", "lb", "each"]);
  });
  it("supplies may end in any unit", () => {
    expect(leafUnitChoices(units, "packaging", null)).toEqual(["oz", "lb", "each", "gal"]);
  });
});
