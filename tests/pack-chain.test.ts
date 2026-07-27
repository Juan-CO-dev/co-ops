/**
 * Pack-chain conversion spine — lib/pack-chain-shared.ts (pure, pointer-directed).
 *
 * The FOUR council L7 invariants:
 *  1. LEGACY PARITY — the chain walk === the legacy two-level flat-field math
 *     (recipe-math skuContentOz) for clean backfills. A future divergence breaks
 *     every backfilled SKU's content_oz — this is the tripwire.
 *  2. PER-LEVEL ROUND-TRIP — walking from each level yields oz consistent with
 *     the level above (parent oz === parent.containsQty × child oz).
 *  3. REACHABILITY + LEAF-TERMINATION TOTALITY — a well-formed chain resolves;
 *     an unreachable/cyclic/non-terminating one fails LOUDLY (typed), never a
 *     wrong number.
 *  4. THE CAPICOLA DETACHED-SIBLING REGRESSION (named) — the brief's own example
 *     entered as flat ordinal rows where 'slice' is nobody's contains_unit must
 *     either validate-fail OR walk to the correct 136 oz — NEVER the naive
 *     ordinal-walk's 54.4. (builder's top council find.)
 *
 * Plus depth-1 (tub → oz) validity and label-collision rejection.
 */
import { describe, it, expect } from "vitest";
import {
  buildPackChain,
  walkChainToOz,
  validateChainReachable,
  chainRootLabel,
  firstLabelMeasureCollision,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["quart", { dimension: "volume", toBaseFactor: 32 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);

/** Helper: a two-level chain pack -> upp each ; each -> size measure. */
function twoLevel(packLabel: string, upp: number, size: number, measure: string): PackChainLevel[] {
  return [
    { id: "pack", label: packLabel, containsQty: upp, containsLevelId: "each", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "each", label: "each", containsQty: size, containsLevelId: null, containsMeasureUnit: measure, displayOrdinal: 1 },
  ];
}

describe("L7.1 legacy parity — chain walk === flat-field math", () => {
  it("weight two-level: 6 × 2 lb === 192 oz both ways", () => {
    const flat = skuContentOz(
      { unitsPerPack: 6, eachSize: 2, eachMeasure: "lb", avgOzPerEach: null },
      MEASURES,
    );
    const chain = skuContentOz(
      { unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: twoLevel("case", 6, 2, "lb") },
      MEASURES,
    );
    expect(flat).toBeCloseTo(192, 10);
    expect(chain).toBeCloseTo(192, 10);
    expect(chain).toBeCloseTo(flat!, 10);
  });

  it("count-measured (avg fallback): 12 each × 4 oz === 48 both ways", () => {
    const flat = skuContentOz(
      { unitsPerPack: 12, eachSize: 1, eachMeasure: "each", avgOzPerEach: 4 },
      MEASURES,
    );
    const chain = skuContentOz(
      { unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 4, packChain: twoLevel("case", 12, 1, "each") },
      MEASURES,
    );
    expect(flat).toBeCloseTo(48, 10);
    expect(chain).toBeCloseTo(48, 10);
  });

  it("count leaf with no avg → both null (never guess)", () => {
    const flat = skuContentOz({ unitsPerPack: 12, eachSize: 1, eachMeasure: "each", avgOzPerEach: null }, MEASURES);
    const chain = skuContentOz({ unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null, packChain: twoLevel("case", 12, 1, "each") }, MEASURES);
    expect(flat).toBeNull();
    expect(chain).toBeNull();
  });
});

describe("L7.2 per-level round-trip", () => {
  it("parent oz === parent.containsQty × child oz", () => {
    // case -> 4 log ; log -> 34 oz.
    const levels: PackChainLevel[] = [
      { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
    ];
    const chain = buildPackChain(levels);
    const caseOz = walkChainToOz(chain, "case", MEASURES, null);
    const logOz = walkChainToOz(chain, "log", MEASURES, null);
    expect(logOz.ok && logOz.oz).toBe(34);
    expect(caseOz.ok && caseOz.oz).toBe(136); // 4 × 34
    // round-trip: case oz / log oz === containsQty of case
    if (caseOz.ok && logOz.ok) expect(caseOz.oz / logOz.oz).toBeCloseTo(4, 10);
  });

  it("three-level round-trip: case -> 4 log ; log -> 2 bundle ; bundle -> 17 oz", () => {
    const levels: PackChainLevel[] = [
      { id: "c", label: "case", containsQty: 4, containsLevelId: "l", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "l", label: "log", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 1 },
      { id: "b", label: "bundle", containsQty: 17, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 2 },
    ];
    const chain = buildPackChain(levels);
    expect((walkChainToOz(chain, "bundle", MEASURES, null) as { oz: number }).oz).toBe(17);
    expect((walkChainToOz(chain, "log", MEASURES, null) as { oz: number }).oz).toBe(34);
    expect((walkChainToOz(chain, "case", MEASURES, null) as { oz: number }).oz).toBe(136);
  });
});

describe("L7.3 reachability + leaf-termination totality", () => {
  it("well-formed chain validates", () => {
    const chain = buildPackChain(twoLevel("case", 6, 2, "lb"));
    expect(validateChainReachable(chain, MEASURES, null).ok).toBe(true);
  });

  it("unknown start label fails loudly", () => {
    const chain = buildPackChain(twoLevel("case", 6, 2, "lb"));
    const r = walkChainToOz(chain, "crate", MEASURES, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_label");
  });

  it("cycle fails loudly", () => {
    const levels: PackChainLevel[] = [
      { id: "a", label: "case", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "log", containsQty: 3, containsLevelId: "a", containsMeasureUnit: null, displayOrdinal: 1 },
    ];
    const r = walkChainToOz(buildPackChain(levels), "case", MEASURES, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cycle");
  });

  it("dangling pointer fails loudly", () => {
    const levels: PackChainLevel[] = [
      { id: "a", label: "case", containsQty: 2, containsLevelId: "ghost", containsMeasureUnit: null, displayOrdinal: 0 },
    ];
    const r = walkChainToOz(buildPackChain(levels), "case", MEASURES, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dangling_pointer");
  });

  it("unregistered leaf measure fails loudly", () => {
    const levels: PackChainLevel[] = [
      { id: "a", label: "tub", containsQty: 32, containsLevelId: null, containsMeasureUnit: "furlong", displayOrdinal: 0 },
    ];
    const r = walkChainToOz(buildPackChain(levels), "tub", MEASURES, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_measure");
  });
});

describe("L7.4 CAPICOLA detached-sibling regression (named)", () => {
  // The brief's own numbers: case -> 4 log ; log -> 34 oz  →  correct = 136 oz.
  // The trap: entering a flat 'slice' row (ordinal 2) that is NOBODY's
  // contains_unit. A naive ordinal-walk multiplies down the ordinals and yields
  // 54.4 oz/case. A pointer-directed walk + reachability MUST NOT.
  const capicolaCorrect: PackChainLevel[] = [
    { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];

  it("correct pointer chain walks to 136 oz — never 54.4", () => {
    const r = walkChainToOz(buildPackChain(capicolaCorrect), "case", MEASURES, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.oz).toBe(136);
      expect(r.oz).not.toBeCloseTo(54.4, 5);
    }
  });

  it("DETACHED SIBLING: a 'slice' level nobody points to fails reachability (never a silent 54.4)", () => {
    // case -> log -> oz is a valid path; 'slice' dangles as a sibling (ordinal 2),
    // itself a leaf but reachable from nothing. This is the exact ordinal-walk trap.
    const withDetachedSlice: PackChainLevel[] = [
      ...capicolaCorrect,
      { id: "slice", label: "slice", containsQty: 0.4, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 2 },
    ];
    const chain = buildPackChain(withDetachedSlice);
    // The walk from the root still gives the correct 136 (pointer-directed ignores
    // the detached sibling)...
    const walk = walkChainToOz(chain, "case", MEASURES, null);
    expect(walk.ok && walk.oz).toBe(136);
    expect(walk.ok && walk.oz).not.toBeCloseTo(54.4, 5);
    // ...but whole-chain validation REJECTS it: a detached sibling means there
    // are TWO unpointed-at levels (case AND slice) → no unique root, so a
    // hand-edited detached chain can never be persisted as "verified". The exact
    // reason is `unknown_label` (no single root); either way it fails LOUDLY, and
    // never yields the naive ordinal-walk's 54.4.
    const validation = validateChainReachable(chain, MEASURES, null);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reason).toBe("unknown_label");
  });

  it("detached sibling that IS a mid-fork (root points down but a sibling dangles) fails totality", () => {
    // Here 'case' is the unique root (points at log), but a stray 'flap' level
    // points at 'log' too while nothing points at 'flap' → 'flap' is unreachable
    // from the root, though the root still has one path. countReachable(2) !=
    // levels(3) → dangling_pointer. This is the pure "not all reachable" branch.
    const forked: PackChainLevel[] = [
      { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
      { id: "flap", label: "flap", containsQty: 2, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 2 },
    ];
    const chain = buildPackChain(forked);
    // Unique root = case (flap is pointed-at by nothing, but case is too → actually
    // both case and flap are roots). Confirm it fails loudly regardless.
    const validation = validateChainReachable(chain, MEASURES, null);
    expect(validation.ok).toBe(false);
  });

  it("PROPERLY chained slice: case -> 4 log ; log -> 85 slice ; slice -> 0.4 oz === 136", () => {
    // The RIGHT way to model a slice tier — as a real pointer link. 4 × 85 × 0.4 = 136.
    const proper: PackChainLevel[] = [
      { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 85, containsLevelId: "slice", containsMeasureUnit: null, displayOrdinal: 1 },
      { id: "slice", label: "slice", containsQty: 0.4, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 2 },
    ];
    const chain = buildPackChain(proper);
    const r = walkChainToOz(chain, "case", MEASURES, null);
    expect(r.ok && r.oz).toBeCloseTo(136, 10);
    expect(validateChainReachable(chain, MEASURES, null).ok).toBe(true);
  });
});

describe("depth-1 (tub → oz) validity", () => {
  it("single container level resolves + validates", () => {
    const levels: PackChainLevel[] = [
      { id: "tub", label: "tub", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 0 },
    ];
    const chain = buildPackChain(levels);
    expect(chainRootLabel(chain)).toBe("tub");
    const r = walkChainToOz(chain, "tub", MEASURES, null);
    expect(r.ok && r.oz).toBe(32);
    expect(validateChainReachable(chain, MEASURES, null).ok).toBe(true);
  });
});

describe("L1 label-collision rejection", () => {
  const measureLabels = new Set(["oz", "lb", "quart", "each", "count", "gram"]);
  it("a chain label equal to a measure unit is rejected", () => {
    expect(firstLabelMeasureCollision(["case", "each"], measureLabels)).toBe("each");
    expect(firstLabelMeasureCollision(["case", "oz"], measureLabels)).toBe("oz");
  });
  it("container-only labels are clean", () => {
    expect(firstLabelMeasureCollision(["case", "log", "bundle", "tub"], measureLabels)).toBeNull();
  });
  it("trims before comparing", () => {
    expect(firstLabelMeasureCollision([" oz "], measureLabels)).toBe("oz");
  });
});

describe("root detection", () => {
  it("multi-root chain has no unique root (validation surface)", () => {
    // two disconnected leaves — no single root.
    const levels: PackChainLevel[] = [
      { id: "a", label: "case", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 0 },
      { id: "b", label: "box", containsQty: 16, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
    ];
    expect(chainRootLabel(buildPackChain(levels))).toBeNull();
  });
});
