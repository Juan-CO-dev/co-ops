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
  validateChainStructure,
  isChainUnverified,
  chainRootLabel,
  firstLabelMeasureCollision,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { skuContentOz, ozForRecipeInput, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["quart", { dimension: "volume", toBaseFactor: 32 }],
  // "each" AND "unit" are BOTH active count-dim measure units in prod (seed 10).
  // A chain label must never collide with either (L1) — the seed-13 review find.
  ["each", { dimension: "count", toBaseFactor: 1 }],
  ["unit", { dimension: "count", toBaseFactor: 1 }],
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

describe("ozForRecipeInput chain integration", () => {
  const capChain: PackChainLevel[] = [
    { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const chainedSku: RecipeInputSku = {
    packFormat: "Case", eachContainerLabel: null,
    unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 1,
    packChain: capChain,
  };

  it("a recipe input naming a CHAIN label walks the chain (2 log = 68 oz)", () => {
    expect(ozForRecipeInput(2, "log", chainedSku, MEASURES)).toBeCloseTo(68, 10);
    expect(ozForRecipeInput(1, "case", chainedSku, MEASURES)).toBeCloseTo(136, 10);
  });

  it("a recipe input naming a MEASURE unit ('oz') still resolves via the registry on a chained SKU", () => {
    // 3 oz weight → 3 oz (chain doesn't swallow measure-unit inputs).
    expect(ozForRecipeInput(3, "oz", chainedSku, MEASURES)).toBeCloseTo(3, 10);
  });

  it("a chained SKU does NOT honor its legacy packFormat label (chain is the source of truth)", () => {
    // "Case" is the flat packFormat, but the chain label is lowercase "case";
    // "Case" is neither a chain label nor a registered measure → null.
    expect(ozForRecipeInput(1, "Case", chainedSku, MEASURES)).toBeNull();
  });

  it("legacy (no chain) SKU still resolves packFormat + eachContainerLabel", () => {
    const legacy: RecipeInputSku = {
      packFormat: "Case", eachContainerLabel: "roll",
      unitsPerPack: 6, eachSize: 4, eachMeasure: "oz", avgOzPerEach: null,
      packChain: null,
    };
    expect(ozForRecipeInput(1, "Case", legacy, MEASURES)).toBeCloseTo(24, 10); // 6 × 4 oz
    expect(ozForRecipeInput(1, "roll", legacy, MEASURES)).toBeCloseTo(4, 10); // 1 × 4 oz
    expect(ozForRecipeInput(2, "oz", legacy, MEASURES)).toBeCloseTo(2, 10);
  });

  it("MEASURE-unit sweep on a chained SKU: 'oz'/'each'/'unit' all resolve via the registry, NOT the chain", () => {
    // The live recipe unit population is oz/each/unit (seed 10). On a chained SKU
    // whose labels DON'T collide (case/log), every one of these must route through
    // the measure registry (step 3), never a container walk. avg = 1 → count units
    // resolve to 1 oz per each/unit.
    expect(ozForRecipeInput(5, "oz", chainedSku, MEASURES)).toBeCloseTo(5, 10);
    expect(ozForRecipeInput(5, "each", chainedSku, MEASURES)).toBeCloseTo(5, 10); // 5 × avg 1
    expect(ozForRecipeInput(5, "unit", chainedSku, MEASURES)).toBeCloseTo(5, 10); // 5 × avg 1
  });
});

// ── REGRESSION (review find 2026-07-27): seed 13 must not label a chain level
//    with an active measure unit ("each"/"unit"). ozForRecipeInput is chain-FIRST,
//    so a colliding label shadows the measure unit — a live recipe line meaning
//    the MEASURE "each" would resolve as one CONTAINER (6×/40× wrong). This block
//    pins BOTH the bug (a) and the fix (b/c). ─────────────────────────────────
describe("seed-13 label-collision regression (chain-first shadowing)", () => {
  // (a) THE BUG, pinned: the OLD seed labeled a container level "each" (an active
  // measure unit). On a chained SKU, ozForRecipeInput(n, 'each', …) then walks
  // the chain instead of the registry — the wrong (container) answer. This is
  // exactly what the fix removes; we pin the divergence to prove the hazard is real.
  // A colliding chain where the walk and the registry give DIFFERENT answers,
  // so "which path was taken" is observable. Here the 'each'-labeled level is the
  // ROOT of a 2-level chain (root "each" -> 6 × leaf ; leaf -> 1 measure "oz"):
  // a recipe line `1 × 'each'` meaning the MEASURE 'each' (avg 4 → 4 oz) instead
  // walks the chain → 6 × 1 = 6 oz. THAT is the silent 6× the finding describes.
  const collidingRootChain: PackChainLevel[] = [
    { id: "each", label: "each", containsQty: 6, containsLevelId: "leaf", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "leaf", label: "leaf", containsQty: 1, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
  const collidingRootSku: RecipeInputSku = {
    packFormat: "pack", eachContainerLabel: null,
    unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 4,
    packChain: collidingRootChain,
  };

  it("(a) a chain level LABELED 'each' shadows the measure unit — chain-first returns the wrong number (the bug)", () => {
    const registryValue = 4; // measure 'each': 1 × avg_oz_per_each (the correct value)
    const shadowed = ozForRecipeInput(1, "each", collidingRootSku, MEASURES);
    // The chain-first path intercepts 'each' and walks: 6 × (1 oz) = 6 — NOT 4.
    expect(shadowed).toBeCloseTo(6, 10);
    expect(shadowed).not.toBeCloseTo(registryValue, 5); // proves the measure value was NOT used
    // The L1 guard the fix adds would reject this chain outright:
    expect(firstLabelMeasureCollision(collidingRootChain.map((l) => l.label), new Set(MEASURES.keys()))).toBe("each");
  });

  // (b) THE FIX, legacy parity: the seed-13-shaped chain with the NEW non-colliding
  // labels ("inner"/"container") lets ozForRecipeInput(n, 'each', …) fall through
  // to the MEASURE registry → the legacy avg value, byte-for-byte.
  const subRollFixed: PackChainLevel[] = [
    // NEW seed 13: root "pack" -> 6 × "inner" ; "inner" -> 1 measure "each".
    { id: "pack", label: "pack", containsQty: 6, containsLevelId: "inner", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "inner", label: "inner", containsQty: 1, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 1 },
  ];
  const subRollFixedSku: RecipeInputSku = {
    packFormat: "pack", eachContainerLabel: null,
    unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 4,
    packChain: subRollFixed,
  };

  it("(b) NEW labels: ozForRecipeInput with unit 'each' returns the MEASURE-registry value (legacy parity)", () => {
    // 'each' is no longer a chain label → step 3 registry: n × avg 4.
    expect(ozForRecipeInput(1, "each", subRollFixedSku, MEASURES)).toBeCloseTo(4, 10);
    expect(ozForRecipeInput(6, "each", subRollFixedSku, MEASURES)).toBeCloseTo(24, 10); // 6 × avg 4
    // And the container labels still walk correctly:
    expect(ozForRecipeInput(1, "pack", subRollFixedSku, MEASURES)).toBeCloseTo(24, 10); // 6 inner × (1 × 4)
    expect(ozForRecipeInput(1, "inner", subRollFixedSku, MEASURES)).toBeCloseTo(4, 10); // 1 × 4
  });

  it("(b') depth-1 each-style chain uses 'container' (not the measure 'unit') → 'unit' falls to the registry", () => {
    // A 'pack_format = Each (no case)' SKU: OLD seed root label was "unit" (a measure
    // unit!). NEW: "container". A recipe line meaning the MEASURE 'unit' must resolve
    // via the registry, not this container.
    const depth1: PackChainLevel[] = [
      { id: "c", label: "container", containsQty: 1, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0 },
    ];
    const sku: RecipeInputSku = {
      packFormat: "Each (no case)", eachContainerLabel: null,
      unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 5,
      packChain: depth1,
    };
    expect(ozForRecipeInput(2, "unit", sku, MEASURES)).toBeCloseTo(10, 10); // 2 × avg 5 (registry)
    expect(ozForRecipeInput(1, "container", sku, MEASURES)).toBeCloseTo(5, 10); // chain walk
  });

  it("(c) firstLabelMeasureCollision REJECTS an 'each'- or 'unit'-labeled chain level", () => {
    const measureLabels = new Set(MEASURES.keys()); // includes 'each' AND 'unit'
    expect(firstLabelMeasureCollision(["pack", "each"], measureLabels)).toBe("each");
    expect(firstLabelMeasureCollision(["unit"], measureLabels)).toBe("unit");
    // The NEW seed labels are clean:
    expect(firstLabelMeasureCollision(["pack", "inner"], measureLabels)).toBeNull();
    expect(firstLabelMeasureCollision(["container"], measureLabels)).toBeNull();
  });
});

// ── THE VALIDATION SPLIT (council 2026-07-28, PR-A) ─────────────────────────
// validateChainReachable conflated structure with oz-resolvability, so a valid
// count-terminated chain (case → 12 each, no avg) got the unverified badge —
// packaging crying wolf (D2). validateChainStructure checks structure ONLY (any
// registered leaf measure, no avg); isChainUnverified is the class-aware badge
// predicate: unverified ⇔ !structural OR (class===raw AND !ozResolvable).
describe("validation split — structural validity (any leaf dimension, no avg)", () => {
  it("weight chain is structurally valid", () => {
    const chain = buildPackChain(twoLevel("case", 6, 2, "lb"));
    expect(validateChainStructure(chain, MEASURES).ok).toBe(true);
  });

  it("COUNT-terminated chain (case → 12 each, NO avg) is structurally valid — the cried-wolf case", () => {
    // The exact false-negative from the old validateChainReachable: this walks to
    // missing_avg (no avg passed) yet is perfectly well-formed. Structure = ok.
    const chain = buildPackChain(twoLevel("case", 12, 1, "each"));
    expect(validateChainStructure(chain, MEASURES).ok).toBe(true);
    // And the old reachable check would have (correctly, but unhelpfully) failed it:
    expect(validateChainReachable(chain, MEASURES, null).ok).toBe(false);
    expect((validateChainReachable(chain, MEASURES, null) as { reason: string }).reason).toBe("missing_avg");
  });

  it("volume-terminated chain (jug → 128 quart) is structurally valid without avg", () => {
    const chain = buildPackChain([
      { id: "j", label: "jug", containsQty: 4, containsLevelId: null, containsMeasureUnit: "quart", displayOrdinal: 0 },
    ]);
    expect(validateChainStructure(chain, MEASURES).ok).toBe(true);
  });

  it("structural check still rejects a detached sibling (fork), any class", () => {
    const forked: PackChainLevel[] = [
      { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
      { id: "flap", label: "flap", containsQty: 2, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 2 },
    ];
    expect(validateChainStructure(buildPackChain(forked), MEASURES).ok).toBe(false);
  });

  it("structural check still rejects an unregistered leaf measure", () => {
    const chain = buildPackChain([
      { id: "a", label: "tub", containsQty: 32, containsLevelId: null, containsMeasureUnit: "furlong", displayOrdinal: 0 },
    ]);
    const r = validateChainStructure(chain, MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_measure");
  });

  it("structural check rejects a cycle below a unique root", () => {
    // A unique root (case, pointed-at by nobody) whose descendants loop: log → bag
    // → log. chainRootLabel finds the root, then the structural walk hits the cycle.
    const levels: PackChainLevel[] = [
      { id: "case", label: "case", containsQty: 2, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 3, containsLevelId: "bag", containsMeasureUnit: null, displayOrdinal: 1 },
      { id: "bag", label: "bag", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 2 },
    ];
    const r = validateChainStructure(buildPackChain(levels), MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cycle");
  });

  it("a 2-node mutual cycle has no unique root → unknown_label (root check fires first)", () => {
    const levels: PackChainLevel[] = [
      { id: "a", label: "case", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "log", containsQty: 3, containsLevelId: "a", containsMeasureUnit: null, displayOrdinal: 1 },
    ];
    const r = validateChainStructure(buildPackChain(levels), MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_label");
  });
});

describe("validation split — isChainUnverified (class-aware badge)", () => {
  const countChain = () => buildPackChain(twoLevel("case", 12, 1, "each")); // count leaf, no avg
  const rawWeight = () => buildPackChain(twoLevel("case", 6, 2, "lb"));

  it("NON-RAW count-terminated chain with NO avg is VERIFIED (complete by design)", () => {
    for (const klass of ["packaging", "cleaning", "misc"] as const) {
      expect(isChainUnverified(countChain(), MEASURES, null, klass)).toBe(false);
    }
  });

  it("RAW count-terminated chain with NO avg is UNVERIFIED (raw must reach oz)", () => {
    expect(isChainUnverified(countChain(), MEASURES, null, "raw")).toBe(true);
  });

  it("RAW count-terminated chain WITH avg is VERIFIED (oz now resolvable)", () => {
    expect(isChainUnverified(countChain(), MEASURES, 4, "raw")).toBe(false);
  });

  it("RAW weight chain is VERIFIED (oz resolvable, no avg needed)", () => {
    expect(isChainUnverified(rawWeight(), MEASURES, null, "raw")).toBe(false);
  });

  it("a STRUCTURAL break is UNVERIFIED for EVERY class (raw and non-raw alike)", () => {
    const forked = buildPackChain([
      { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
      { id: "flap", label: "flap", containsQty: 2, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 2 },
    ]);
    for (const klass of ["raw", "packaging", "cleaning", "misc"] as const) {
      expect(isChainUnverified(forked, MEASURES, null, klass)).toBe(true);
    }
  });

  it("an EMPTY chain is not unverified (that's 'no pack info', not a broken chain)", () => {
    expect(isChainUnverified(buildPackChain([]), MEASURES, null, "raw")).toBe(false);
    expect(isChainUnverified(buildPackChain([]), MEASURES, null, "packaging")).toBe(false);
  });
});

// ── SEED 14 label guard — the shallow-chain generator must never emit a chain
//    label colliding with an active measure unit (the chain-first shadow hazard,
//    the BC class caught twice). Seed 14 builds "case → N inner ; inner → each":
//    the leaf CONTAINER is LABELED "inner" (non-colliding) and CONTAINS the
//    MEASURE "each" — label≠contains_measure_unit, so it is NOT a collision. ──
describe("seed-14 shallow-chain label guard", () => {
  const measureLabels = new Set(MEASURES.keys()); // includes "each" AND "unit"

  function seed14Levels(rootPackFormat: string, upp: number): PackChainLevel[] {
    // Mirrors buildShallowLevels: root = canonicalized pack_format, leaf container
    // labeled "inner" containing the count MEASURE "each".
    const root = rootPackFormat.trim().toLowerCase();
    return [
      { id: "p", label: root === "inner" ? "pack" : root, containsQty: upp, containsLevelId: "i", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "i", label: "inner", containsQty: 1, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 1 },
    ];
  }

  it("the generated LABELS ('case','inner') are clean — 'each' lives in contains_measure_unit, not a label", () => {
    const levels = seed14Levels("Case", 12);
    expect(firstLabelMeasureCollision(levels.map((l) => l.label), measureLabels)).toBeNull();
  });

  it("the shallow chain is STRUCTURALLY valid and its non-raw badge is VERIFIED", () => {
    const chain = buildPackChain(seed14Levels("Box", 24));
    expect(validateChainStructure(chain, MEASURES).ok).toBe(true);
    expect(isChainUnverified(chain, MEASURES, null, "packaging")).toBe(false);
  });

  it("a HYPOTHETICAL generator that LABELED a level 'each' WOULD be caught by the guard", () => {
    // Pins the hazard: if the generator ever emitted "each"/"unit" as a LABEL the
    // shared L1 guard rejects it (exit 1 in the seed). This is the tripwire.
    expect(firstLabelMeasureCollision(["case", "each"], measureLabels)).toBe("each");
    expect(firstLabelMeasureCollision(["unit"], measureLabels)).toBe("unit");
  });

  it("canonicalized 'Each (no case)' root avoids the measure 'unit' (→ 'container')", () => {
    // Seed 14 reuses seed 13's canonicalizer: an each-style pack_format maps to
    // "container", NOT the measure "unit" — so no shadow.
    expect(firstLabelMeasureCollision(["container", "inner"], measureLabels)).toBeNull();
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
