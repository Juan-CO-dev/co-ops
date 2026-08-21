/**
 * Unit spine — lib/admin/cost-shared.ts (the $/oz derivation behind /admin/skus
 * and /admin/vendors/[id]).
 *
 * THE BUG THIS PINS. `computeSkuCostPerOz` used to call `skuContentOz` with no
 * packChain, so those two screens resolved ounces through the LEGACY FLAT TRIO
 * while lib/admin/menu-costing.ts's board resolved them through `graph.skuPack`,
 * which carries the chain. Same SKU, two derivations.
 *
 * Live prod agreed on all 182 SKUs when this was found (63 chained, zero
 * divergence, CC 2026-08-21) — because `replaceSkuPackChain` writes a
 * compensating flat-field mirror on every chain save. But that mirror is a
 * documented stopgap, it fails NON-FATALLY ("chain saved; flat fields stale"),
 * and the ordinary SKU edit path writes `units_per_pack` without touching the
 * chain. So the tests below deliberately exercise a STALE MIRROR: that is the
 * state the fix exists for, and the state no fixture in the repo had.
 */
import { describe, it, expect } from "vitest";

import { computeSkuCostPerOz, contentOzForSku, measureFactorMap } from "@/lib/admin/cost-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitOption } from "@/lib/admin/skus";

const MEASURES: MeasureUnitOption[] = [
  { label: "oz", dimension: "weight", toBaseFactor: 1 } as MeasureUnitOption,
  { label: "lb", dimension: "weight", toBaseFactor: 16 } as MeasureUnitOption,
  { label: "each", dimension: "count", toBaseFactor: 1 } as MeasureUnitOption,
];
const FACTORS: Map<string, MeasureUnitFactor> = measureFactorMap(MEASURES);

/** case → 4 logs → 40 oz each = 160 oz per case (the Ground Beef shape, live). */
function caseOfLogs(logsPerCase: number, ozPerLog: number): PackChainLevel[] {
  return [
    { id: "lvl-case", label: "case", containsQty: logsPerCase, containsLevelId: "lvl-log", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "lvl-log", label: "log", containsQty: ozPerLog, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
  ];
}

const CHAIN = caseOfLogs(4, 40); // 160 oz
const TRUE_FLAT = { unitsPerPack: 4, eachSize: 40, eachMeasure: "oz", avgOzPerEach: null };
const STALE_FLAT = { unitsPerPack: 8, eachSize: 40, eachMeasure: "oz", avgOzPerEach: null }; // mirror drifted

describe("contentOzForSku — the chain is authoritative, the flat trio is a mirror", () => {
  it("agrees with the flat path while the mirror is in sync (the live state today)", () => {
    expect(contentOzForSku(TRUE_FLAT, CHAIN, FACTORS)).toBe(160);
    expect(skuContentOz(TRUE_FLAT, FACTORS)).toBe(160);
  });

  it("IGNORES a stale flat trio entirely when a chain exists", () => {
    // This is the property that makes the chain-aware derivation authoritative:
    // a drifted mirror cannot move the answer.
    expect(contentOzForSku(STALE_FLAT, CHAIN, FACTORS)).toBe(160);
  });

  it("the OLD chain-blind path would have followed the stale mirror off a cliff", () => {
    // 2x wrong, silently, forever. Pinned so the bug class is legible.
    expect(skuContentOz(STALE_FLAT, FACTORS)).toBe(320);
  });

  it("still uses the flat trio for a SKU with no chain (back-compat, unchanged)", () => {
    expect(contentOzForSku(TRUE_FLAT, null, FACTORS)).toBe(160);
    expect(contentOzForSku(TRUE_FLAT, [], FACTORS)).toBe(160);
  });

  it("a malformed chain resolves NULL rather than falling through to guess", () => {
    const broken: PackChainLevel[] = [
      { id: "a", label: "case", containsQty: 4, containsLevelId: "missing", containsMeasureUnit: null, displayOrdinal: 0 },
    ];
    expect(contentOzForSku(TRUE_FLAT, broken, FACTORS)).toBeNull();
  });
});

describe("computeSkuCostPerOz — the two admin screens agree with the costing board", () => {
  const prices = new Map<string, number>([["sku-1", 49.2]]);

  it("costs a chained SKU off its chain, not its flat fields", () => {
    const chains = new Map<string, PackChainLevel[]>([["sku-1", CHAIN]]);
    const out = computeSkuCostPerOz([{ id: "sku-1", ...STALE_FLAT }], prices, MEASURES, chains);
    // $49.20 / 160 oz — the board's number. The chain-blind path would have said
    // $0.1538 (49.20 / 320) on the same row.
    expect(out.get("sku-1")).toBeCloseTo(0.3075, 10);
  });

  it("matches the BOARD's derivation to the cent, on the same inputs", () => {
    // lib/admin/menu-costing.ts derives content_oz as
    // `skuContentOz(graph.skuPack.get(id), graph.measures)` where the pack shape
    // CARRIES packChain. Reproduced here as the oracle.
    const boardPack = { ...STALE_FLAT, packChain: CHAIN };
    const boardOz = skuContentOz(boardPack, FACTORS);
    const boardCostPerOz = 49.2 / (boardOz as number);

    const chains = new Map<string, PackChainLevel[]>([["sku-1", CHAIN]]);
    const screen = computeSkuCostPerOz([{ id: "sku-1", ...STALE_FLAT }], prices, MEASURES, chains);
    expect(screen.get("sku-1")).toBeCloseTo(boardCostPerOz, 10);
  });

  it("an unpriced SKU is null, not zero — unpriced and uncostable read the same", () => {
    const chains = new Map<string, PackChainLevel[]>([["sku-2", CHAIN]]);
    const out = computeSkuCostPerOz([{ id: "sku-2", ...TRUE_FLAT }], new Map(), MEASURES, chains);
    expect(out.get("sku-2")).toBeNull();
  });

  it("a priced SKU with an unresolvable pack is null, not a fabricated number", () => {
    const out = computeSkuCostPerOz(
      [{ id: "sku-1", unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }],
      prices,
      MEASURES,
      new Map(),
    );
    expect(out.get("sku-1")).toBeNull();
  });

  it("an empty chain map is a valid statement, not a crash (unchained catalog)", () => {
    const out = computeSkuCostPerOz([{ id: "sku-1", ...TRUE_FLAT }], prices, MEASURES, new Map());
    expect(out.get("sku-1")).toBeCloseTo(49.2 / 160, 10);
  });
});
