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
  type SkuNameCollisionCandidate,
} from "@/lib/admin/catalog-shared";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";

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
