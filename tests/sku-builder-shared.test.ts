/**
 * Unit spine — SKU Builder streamline pure helpers (design 2026-07-27 §1/§3):
 * skuNameCollisions (non-blocking dedupe), generateQuickPackChain (quick-pack →
 * starter chain), deriveRoleBadges (dual-role graph badges). All pure.
 */
import { describe, it, expect } from "vitest";
import {
  skuNameCollisions,
  generateQuickPackChain,
  deriveRoleBadges,
  deriveFlatFieldsFromChain,
  type SkuNameCollisionCandidate,
  type StarterChainLevel,
} from "@/lib/admin/catalog-shared";
import {
  buildPackChain,
  chainRootLabel,
  walkChainToOz,
  firstLabelMeasureCollision,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";

// ── skuNameCollisions ─────────────────────────────────────────────────────────
describe("skuNameCollisions", () => {
  const skus: SkuNameCollisionCandidate[] = [
    { id: "a", name: "Fresh Mozzarella", active: true },
    { id: "b", name: "fresh mozzarella", active: true }, // case/duplicate of a
    { id: "c", name: "  Fresh Mozzarella  ", active: false }, // inactive → ignored
    { id: "d", name: "Ham", active: true },
  ];

  it("matches case-insensitively and trimmed, active only", () => {
    const hits = skuNameCollisions("FRESH MOZZARELLA", skus);
    expect(hits.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("excludes the SKU being edited via selfId", () => {
    const hits = skuNameCollisions("Fresh Mozzarella", skus, "a");
    expect(hits.map((s) => s.id)).toEqual(["b"]);
  });

  it("ignores inactive matches", () => {
    // "c" is an exact (trimmed) match but inactive → never returned.
    expect(skuNameCollisions("Fresh Mozzarella", skus).some((s) => s.id === "c")).toBe(false);
  });

  it("returns [] for a blank / whitespace name", () => {
    expect(skuNameCollisions("   ", skus)).toEqual([]);
    expect(skuNameCollisions("", skus)).toEqual([]);
  });

  it("returns [] when nothing collides", () => {
    expect(skuNameCollisions("Provolone", skus)).toEqual([]);
  });

  it("trims the needle before comparing", () => {
    expect(skuNameCollisions("  Ham  ", skus).map((s) => s.id)).toEqual(["d"]);
  });
});

// ── generateQuickPackChain ────────────────────────────────────────────────────
describe("generateQuickPackChain", () => {
  it("returns null when eachSize is missing (bare save stays valid)", () => {
    expect(generateQuickPackChain({ unitsPerPack: 6, eachSize: null, eachMeasure: "oz" })).toBeNull();
  });

  it("returns null when eachMeasure is blank", () => {
    expect(generateQuickPackChain({ unitsPerPack: 6, eachSize: 32, eachMeasure: "  " })).toBeNull();
    expect(generateQuickPackChain({ unitsPerPack: 6, eachSize: 32, eachMeasure: null })).toBeNull();
  });

  it("returns null when eachSize is non-positive", () => {
    expect(generateQuickPackChain({ unitsPerPack: 6, eachSize: 0, eachMeasure: "oz" })).toBeNull();
    expect(generateQuickPackChain({ unitsPerPack: 6, eachSize: -4, eachMeasure: "oz" })).toBeNull();
  });

  it("builds a 2-level chain when unitsPerPack > 1 (pack → each → measure)", () => {
    const chain = generateQuickPackChain({
      unitsPerPack: 6,
      eachSize: 32,
      eachMeasure: "oz",
      packLabel: "Case",
      eachLabel: "log",
    });
    expect(chain).toEqual([
      { label: "Case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null },
      { label: "log", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
    ]);
  });

  it("builds a single leaf when unitsPerPack is null/1 (inner → measure)", () => {
    expect(generateQuickPackChain({ unitsPerPack: null, eachSize: 32, eachMeasure: "oz" })).toEqual([
      { label: "inner", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
    ]);
    expect(generateQuickPackChain({ unitsPerPack: 1, eachSize: 12, eachMeasure: "lb" })).toEqual([
      { label: "inner", containsQty: 12, containsIndex: null, containsMeasureUnit: "lb" },
    ]);
  });

  it("defaults labels to SAFE generic names (inner / pack, NOT the measure word 'each')", () => {
    const chain = generateQuickPackChain({ unitsPerPack: 4, eachSize: 34, eachMeasure: "oz" });
    expect(chain).toEqual([
      { label: "pack", containsQty: 4, containsIndex: 1, containsMeasureUnit: null },
      { label: "inner", containsQty: 34, containsIndex: null, containsMeasureUnit: "oz" },
    ]);
  });

  // ── F1 (adversarial review #1 CRITICAL): mint-then-destroy guard ────────────
  // The default each-level label MUST NOT be a measure_units label. "each" (the
  // old default) IS an active measure unit, so a generated leaf labeled "each"
  // would fail replaceSkuPackChain's L1 namespace rule (label_is_measure_unit)
  // AFTER createSku already minted the SKU. These tests are integration-shaped:
  // they walk the generated chain's labels through firstLabelMeasureCollision
  // (the exact write-path collision check) against a measure set that includes
  // each/unit/oz/count.
  const measureSet = new Set(["each", "unit", "oz", "count"]);

  it("generated 1-level default-label chain has NO measure-unit collision", () => {
    const chain = generateQuickPackChain({ unitsPerPack: null, eachSize: 32, eachMeasure: "oz" });
    expect(chain).not.toBeNull();
    const labels = chain!.map((l) => l.label);
    expect(firstLabelMeasureCollision(labels, measureSet)).toBeNull();
  });

  it("generated 2-level default-label chain has NO measure-unit collision", () => {
    const chain = generateQuickPackChain({ unitsPerPack: 6, eachSize: 34, eachMeasure: "oz" });
    expect(chain).not.toBeNull();
    const labels = chain!.map((l) => l.label);
    expect(firstLabelMeasureCollision(labels, measureSet)).toBeNull();
  });

  it("never emits 'each' or 'unit' as a generated label (1- and 2-level)", () => {
    const one = generateQuickPackChain({ unitsPerPack: 1, eachSize: 12, eachMeasure: "lb" })!;
    const two = generateQuickPackChain({ unitsPerPack: 4, eachSize: 34, eachMeasure: "oz" })!;
    for (const level of [...one, ...two]) {
      expect(level.label).not.toBe("each");
      expect(level.label).not.toBe("unit");
    }
  });

  it("returns null (bare valid save) when a caller-supplied label WOULD collide", () => {
    // Manager typed "oz" as the each name → the generated leaf would be rejected
    // downstream. The measureLabels guard bails to a bare unchained save instead.
    expect(
      generateQuickPackChain(
        { unitsPerPack: null, eachSize: 32, eachMeasure: "oz", eachLabel: "oz" },
        measureSet,
      ),
    ).toBeNull();
    // Case-insensitive + trimmed: "  EACH  " as a pack label also collides.
    expect(
      generateQuickPackChain(
        { unitsPerPack: 6, eachSize: 32, eachMeasure: "oz", packLabel: "  EACH  " },
        measureSet,
      ),
    ).toBeNull();
  });

  it("still generates a chain when labels are clean, even with a measure set passed", () => {
    const chain = generateQuickPackChain(
      { unitsPerPack: 6, eachSize: 32, eachMeasure: "oz", packLabel: "Case", eachLabel: "log" },
      measureSet,
    );
    expect(chain).toEqual([
      { label: "Case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null },
      { label: "log", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
    ]);
  });
});

// ── deriveFlatFieldsFromChain (SKU top-tier PR-B, sync-on-save) ────────────────
// The derivation MUST reproduce the chain's content-oz through the LEGACY
// flat-field math (units_per_pack × each_size × ozPer(measure,avg)), because
// sku-demand's skuContentOz reads flat fields WITHOUT a chain until PR-C. Each
// case pairs the derivation with a walk/flat parity assertion where meaningful.
describe("deriveFlatFieldsFromChain", () => {
  const MEASURES = new Map<string, MeasureUnitFactor>([
    ["oz", { dimension: "weight", toBaseFactor: 1 }],
    ["lb", { dimension: "weight", toBaseFactor: 16 }],
    ["quart", { dimension: "volume", toBaseFactor: 32 }],
    ["each", { dimension: "count", toBaseFactor: 1 }],
  ]);

  /** Turn the index-linked StarterChainLevel[] the wizard produces into the
   *  id-linked PackChainLevel[] the pure walk consumes (index → "L<i>" id). */
  function toWalkable(levels: StarterChainLevel[]): PackChainLevel[] {
    return levels.map((l, i) => ({
      id: `L${i}`,
      label: l.label,
      containsQty: l.containsQty,
      containsLevelId: l.containsIndex != null ? `L${l.containsIndex}` : null,
      containsMeasureUnit: l.containsMeasureUnit,
      displayOrdinal: i,
    }));
  }

  it("empty chain → all null", () => {
    expect(deriveFlatFieldsFromChain([])).toEqual({
      packFormat: null,
      unitsPerPack: null,
      eachSize: null,
      eachMeasure: null,
    });
  });

  it("2-level raw oz leaf: case → 6 × log ; log → 32 oz → Case/6/32/oz, parity 192", () => {
    const chain: StarterChainLevel[] = [
      { label: "Case", containsQty: 6, containsIndex: 1, containsMeasureUnit: null },
      { label: "log", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
    ];
    const flat = deriveFlatFieldsFromChain(chain);
    expect(flat).toEqual({ packFormat: "Case", unitsPerPack: 6, eachSize: 32, eachMeasure: "oz" });
    // Parity: flat-field math === chain walk === 192.
    const walkable = toWalkable(chain);
    const walk = walkChainToOz(buildPackChain(walkable), chainRootLabel(buildPackChain(walkable))!, MEASURES, null);
    const flatOz = skuContentOz(
      { unitsPerPack: flat.unitsPerPack, eachSize: flat.eachSize, eachMeasure: flat.eachMeasure, avgOzPerEach: null },
      MEASURES,
    );
    expect(walk.ok && walk.oz).toBe(192);
    expect(flatOz).toBeCloseTo(192, 10);
  });

  it("3-level raw avg leaf collapses non-leaf qtys: case(4) → log(2) → bundle(17 each) → units 8, parity 136 with avg 1", () => {
    const chain: StarterChainLevel[] = [
      { label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null },
      { label: "log", containsQty: 2, containsIndex: 2, containsMeasureUnit: null },
      { label: "bundle", containsQty: 17, containsIndex: null, containsMeasureUnit: "each" },
    ];
    const flat = deriveFlatFieldsFromChain(chain);
    // units_per_pack = 4 × 2 = 8 (product of the two NON-leaf container qtys).
    expect(flat).toEqual({ packFormat: "case", unitsPerPack: 8, eachSize: 17, eachMeasure: "each" });
    // Parity with avg 1 (count leaf): flat = 8 × 17 × 1 = 136 = walk 4×(2×(17×1)).
    const walkable = toWalkable(chain);
    const walk = walkChainToOz(buildPackChain(walkable), chainRootLabel(buildPackChain(walkable))!, MEASURES, 1);
    const flatOz = skuContentOz(
      { unitsPerPack: flat.unitsPerPack, eachSize: flat.eachSize, eachMeasure: flat.eachMeasure, avgOzPerEach: 1 },
      MEASURES,
    );
    expect(walk.ok && walk.oz).toBe(136);
    expect(flatOz).toBeCloseTo(136, 10);
  });

  it("single-leaf chain (root IS the leaf): tub → 32 oz → units_per_pack null, size 32", () => {
    const chain: StarterChainLevel[] = [
      { label: "tub", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
    ];
    expect(deriveFlatFieldsFromChain(chain)).toEqual({
      packFormat: "tub",
      unitsPerPack: null, // no non-leaf level
      eachSize: 32,
      eachMeasure: "oz",
    });
  });

  it("shallow packaging count chain (case → 12 inner ; inner → each): units 12, measure 'each', size 1", () => {
    // The seed-14 shape: leaf LABELED 'inner' CONTAINS the count measure 'each'.
    const chain: StarterChainLevel[] = [
      { label: "case", containsQty: 12, containsIndex: 1, containsMeasureUnit: null },
      { label: "inner", containsQty: 1, containsIndex: null, containsMeasureUnit: "each" },
    ];
    const flat = deriveFlatFieldsFromChain(chain);
    expect(flat).toEqual({ packFormat: "case", unitsPerPack: 12, eachSize: 1, eachMeasure: "each" });
    // Packaging becomes pack-complete for ordering (units+size+measure all set).
    // Content-oz is null both ways (count leaf, no avg) — consistent.
    const flatOz = skuContentOz(
      { unitsPerPack: flat.unitsPerPack, eachSize: flat.eachSize, eachMeasure: flat.eachMeasure, avgOzPerEach: null },
      MEASURES,
    );
    expect(flatOz).toBeNull();
  });

  it("cleaning opt-in oz leaf (jug → 128 quart): units null, size 128, measure 'quart'", () => {
    // Cleaning's opt-in size swaps the bare count leaf for a volume size leaf.
    const chain: StarterChainLevel[] = [
      { label: "jug", containsQty: 128, containsIndex: null, containsMeasureUnit: "quart" },
    ];
    expect(deriveFlatFieldsFromChain(chain)).toEqual({
      packFormat: "jug",
      unitsPerPack: null,
      eachSize: 128,
      eachMeasure: "quart",
    });
  });

  it("malformed (no unique root — two disconnected leaves) → all null (never guess)", () => {
    const chain: StarterChainLevel[] = [
      { label: "case", containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
      { label: "box", containsQty: 16, containsIndex: null, containsMeasureUnit: "oz" },
    ];
    expect(deriveFlatFieldsFromChain(chain)).toEqual({
      packFormat: null,
      unitsPerPack: null,
      eachSize: null,
      eachMeasure: null,
    });
  });

  it("malformed (dangling pointer) → all null", () => {
    const chain: StarterChainLevel[] = [
      { label: "case", containsQty: 6, containsIndex: 5, containsMeasureUnit: null }, // points at nonexistent index 5
    ];
    expect(deriveFlatFieldsFromChain(chain)).toEqual({
      packFormat: null,
      unitsPerPack: null,
      eachSize: null,
      eachMeasure: null,
    });
  });

  it("non-leaf with a bad qty → all null (never fold a garbage multiplier)", () => {
    const chain: StarterChainLevel[] = [
      { label: "case", containsQty: 0, containsIndex: 1, containsMeasureUnit: null },
      { label: "inner", containsQty: 1, containsIndex: null, containsMeasureUnit: "each" },
    ];
    expect(deriveFlatFieldsFromChain(chain).eachMeasure).toBeNull();
  });
});

// ── PackChainWizard generated-label collision guard ────────────────────────────
// The wizard's ONLY generated (default) labels are "container" (root) and
// "inner" (deeper levels + the size leaf); a non-raw bare count leaf is LABELED
// "inner" and CONTAINS the measure "each". None of these labels may collide with
// an active measure-unit label (the BC shadowing class, caught twice) — the
// chain-first ozForRecipeInput would over-deplete. This mirrors the exact chain
// shapes the wizard's `assembled` memo emits for each class path and runs them
// through the SAME firstLabelMeasureCollision guard the write path enforces.
describe("PackChainWizard generated-label collision safety", () => {
  // Active measure units in prod include "each" AND "unit" (seed 10) — the two
  // count words a generated LABEL must never be.
  const measureLabels = new Set(["oz", "lb", "quart", "each", "unit", "count"]);

  // Wizard defaults (mirrors the component's local constants).
  const ROOT = "container";
  const INNER = "inner";
  const COUNT_LEAF_MEASURE = "each";

  /** raw path: container(root) → N inner ; inner → S weight/measure (size leaf). */
  const rawTwoLevel: StarterChainLevel[] = [
    { label: ROOT, containsQty: 6, containsIndex: 1, containsMeasureUnit: null },
    { label: INNER, containsQty: 32, containsIndex: null, containsMeasureUnit: "oz" },
  ];
  /** packaging/misc bare count leaf: the current level LABELED (defaulted)
   *  "container" holds N of the count MEASURE "each". */
  const bareCountLeaf: StarterChainLevel[] = [
    { label: ROOT, containsQty: 12, containsIndex: null, containsMeasureUnit: COUNT_LEAF_MEASURE },
  ];
  /** packaging with an outer container: container → 12 inner ; inner → 1 each. */
  const packagingTwoLevel: StarterChainLevel[] = [
    { label: ROOT, containsQty: 12, containsIndex: 1, containsMeasureUnit: null },
    { label: INNER, containsQty: 1, containsIndex: null, containsMeasureUnit: COUNT_LEAF_MEASURE },
  ];

  it("no wizard-generated default LABEL collides with an active measure unit", () => {
    for (const chain of [rawTwoLevel, bareCountLeaf, packagingTwoLevel]) {
      expect(firstLabelMeasureCollision(chain.map((l) => l.label), measureLabels)).toBeNull();
    }
  });

  it("a bare count leaf LABELED 'container' CONTAINS the measure 'each' — label≠measure, not a collision", () => {
    // The label is "container"; "each" lives in contains_measure_unit (a different
    // column). This is a count chain, not a shadow.
    const labels = bareCountLeaf.map((l) => l.label);
    expect(labels).not.toContain("each");
    expect(labels).not.toContain("unit");
    expect(firstLabelMeasureCollision(labels, measureLabels)).toBeNull();
    expect(bareCountLeaf[0]!.containsMeasureUnit).toBe("each");
  });

  it("the wizard's raw size-leaf uses 'inner' (not the measure word 'each'/'unit')", () => {
    expect(rawTwoLevel[1]!.label).toBe(INNER);
    expect(rawTwoLevel[1]!.label).not.toBe("each");
    expect(rawTwoLevel[1]!.label).not.toBe("unit");
  });

  it("a non-raw bare count chain is structurally valid and VERIFIED (complete by design)", () => {
    const walkable: PackChainLevel[] = packagingTwoLevel.map((l, i) => ({
      id: `L${i}`,
      label: l.label,
      containsQty: l.containsQty,
      containsLevelId: l.containsIndex != null ? `L${l.containsIndex}` : null,
      containsMeasureUnit: l.containsMeasureUnit,
      displayOrdinal: i,
    }));
    expect(chainRootLabel(buildPackChain(walkable))).toBe("container");
    // derives to units 12, size 1, measure each — pack-complete for ordering.
    expect(deriveFlatFieldsFromChain(packagingTwoLevel)).toEqual({
      packFormat: "container",
      unitsPerPack: 12,
      eachSize: 1,
      eachMeasure: "each",
    });
  });
});

// ── deriveRoleBadges ──────────────────────────────────────────────────────────
describe("deriveRoleBadges", () => {
  it("a bought-only on-hand raw has no badges", () => {
    expect(
      deriveRoleBadges({ soldDirectly: false, usedInBuilds: 0, hasProducingRecipe: false }),
    ).toEqual([]);
  });

  it("a made-and-sold-and-used item reads made · sold · used in N (deli-label order)", () => {
    expect(
      deriveRoleBadges({ soldDirectly: true, usedInBuilds: 3, hasProducingRecipe: true }),
    ).toEqual([
      { role: "made" },
      { role: "sold" },
      { role: "used_in_builds", count: 3 },
    ]);
  });

  it("a sold-only item (bought and resold) shows just sold", () => {
    expect(
      deriveRoleBadges({ soldDirectly: true, usedInBuilds: 0, hasProducingRecipe: false }),
    ).toEqual([{ role: "sold" }]);
  });

  it("a made-and-consumed prep (not sold) shows made · used in N", () => {
    expect(
      deriveRoleBadges({ soldDirectly: false, usedInBuilds: 2, hasProducingRecipe: true }),
    ).toEqual([
      { role: "made" },
      { role: "used_in_builds", count: 2 },
    ]);
  });
});
