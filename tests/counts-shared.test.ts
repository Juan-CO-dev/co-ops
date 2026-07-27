/**
 * Manager physical-count math — lib/counts-shared.ts (pure).
 *
 * Coverage (brief step 5):
 *  - mixed-level line resolution through the pack chain (case + loose logs)
 *  - partial_fraction multiplier (half a tub)
 *  - anchor summation (disjoint full + loose lines add)
 *  - anchor + drift (received − consumed IN OZ, Juan's feed/verify model)
 *  - null-drift advisory (a missing derive side → null, never a fabricated number)
 *  - variance vs the previous count + intervening ledger (L8 shrinkage)
 */
import { describe, it, expect } from "vitest";
import {
  resolveCountLineOz,
  resolveCountLines,
  sumAnchorOzBySku,
  computeOnHand,
  computeVariance,
  anchorAgeDays,
  chainLabelsInWalkOrder,
  type CountLineInput,
} from "@/lib/counts-shared";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);

// Capicola: case -> 4 log ; log -> 34 oz  →  case = 136 oz, log = 34 oz.
const capChain: PackChainLevel[] = [
  { id: "case", label: "case", containsQty: 4, containsLevelId: "log", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "log", label: "log", containsQty: 34, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
];
const capSku: RecipeInputSku = {
  packFormat: "Case", eachContainerLabel: null,
  unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
  packChain: capChain,
};

// A tub SKU (depth-1): tub -> 32 oz.
const tubChain: PackChainLevel[] = [
  { id: "tub", label: "tub", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 0 },
];
const tubSku: RecipeInputSku = {
  packFormat: "tub", eachContainerLabel: null,
  unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
  packChain: tubChain,
};

describe("resolveCountLineOz — mixed-level resolution", () => {
  it("a whole 'case' line resolves to 136 oz", () => {
    const r = resolveCountLineOz({ levelLabel: "case", qty: 2, partialFraction: null }, capSku, MEASURES);
    expect(r.ok && r.oz).toBe(272); // 2 × 136
  });

  it("a loose 'log' line resolves to 34 oz each", () => {
    const r = resolveCountLineOz({ levelLabel: "log", qty: 3, partialFraction: null }, capSku, MEASURES);
    expect(r.ok && r.oz).toBe(102); // 3 × 34
  });

  it("partial_fraction scales the line (half a tub = 16 oz)", () => {
    const r = resolveCountLineOz({ levelLabel: "tub", qty: 1, partialFraction: 0.5 }, tubSku, MEASURES);
    expect(r.ok && r.oz).toBe(16);
  });

  it("bad qty fails loudly", () => {
    const r = resolveCountLineOz({ levelLabel: "case", qty: -1, partialFraction: null }, capSku, MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_qty");
  });

  it("bad fraction (>1) fails loudly", () => {
    const r = resolveCountLineOz({ levelLabel: "tub", qty: 1, partialFraction: 1.5 }, tubSku, MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_fraction");
  });

  it("an unresolvable level (unknown label, no measure) fails loudly", () => {
    const r = resolveCountLineOz({ levelLabel: "crate", qty: 1, partialFraction: null }, capSku, MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unresolvable");
  });
});

describe("resolveCountLines — batch + unknown sku", () => {
  const skuById = new Map<string, RecipeInputSku>([["cap", capSku], ["tub", tubSku]]);
  it("resolves a mixed-level session: 2 cases + 3 loose logs + half a tub", () => {
    const lines: CountLineInput[] = [
      { skuId: "cap", levelLabel: "case", qty: 2, isLoose: false, partialFraction: null },
      { skuId: "cap", levelLabel: "log", qty: 3, isLoose: true, partialFraction: null },
      { skuId: "tub", levelLabel: "tub", qty: 1, isLoose: false, partialFraction: 0.5 },
    ];
    const res = resolveCountLines(lines, skuById, MEASURES);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resolved[0]!.resolvedOz).toBe(272);
      expect(res.resolved[1]!.resolvedOz).toBe(102);
      expect(res.resolved[2]!.resolvedOz).toBe(16);
    }
  });

  it("an unknown SKU fails loudly (a count line with no oz can't anchor)", () => {
    const lines: CountLineInput[] = [{ skuId: "ghost", levelLabel: "case", qty: 1, isLoose: false, partialFraction: null }];
    const res = resolveCountLines(lines, skuById, MEASURES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown_sku");
  });

  it("an unresolvable line fails the whole batch (rejects rather than store null)", () => {
    const lines: CountLineInput[] = [{ skuId: "cap", levelLabel: "pallet", qty: 1, isLoose: false, partialFraction: null }];
    const res = resolveCountLines(lines, skuById, MEASURES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unresolvable");
  });
});

describe("sumAnchorOzBySku — disjoint full + loose add", () => {
  it("2 cases (272) + 3 loose logs (102) for the same SKU sum to 374 oz", () => {
    const anchor = sumAnchorOzBySku([
      { skuId: "cap", resolvedOz: 272 },
      { skuId: "cap", resolvedOz: 102 },
    ]);
    expect(anchor.get("cap")).toBe(374);
  });
});

describe("computeOnHand — Juan's feed/verify model (oz-native)", () => {
  const now = Date.parse("2026-07-27T12:00:00Z");
  it("on-hand = anchor + received − consumed", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 136, consumedSinceOz: 100, anchorStale: false },
      now,
    );
    expect(r.driftOz).toBe(36); // 136 − 100
    expect(r.onHandOz).toBe(410); // 374 + 36
    expect(r.anchorAgeDays).toBe(2);
  });

  it("null received → null drift → null on-hand (advisory, never fabricated)", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: null, consumedSinceOz: 100, anchorStale: false },
      now,
    );
    expect(r.driftOz).toBeNull();
    expect(r.onHandOz).toBeNull();
  });

  it("null consumed → null drift → null on-hand", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 136, consumedSinceOz: null, anchorStale: false },
      now,
    );
    expect(r.driftOz).toBeNull();
    expect(r.onHandOz).toBeNull();
  });

  it("never-counted SKU (null anchor) → null on-hand even with clean drift", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: null, anchorAt: null, receivedSinceOz: 136, consumedSinceOz: 100, anchorStale: false },
      now,
    );
    expect(r.driftOz).toBe(36);
    expect(r.onHandOz).toBeNull();
    expect(r.anchorAgeDays).toBeNull();
  });

  it("carries the retro-edit staleness flag through", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 100, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 0, consumedSinceOz: 0, anchorStale: true },
      now,
    );
    expect(r.anchorStale).toBe(true);
  });
});

describe("anchorAgeDays", () => {
  const now = Date.parse("2026-07-27T12:00:00Z");
  it("floors whole days", () => {
    expect(anchorAgeDays("2026-07-25T18:00:00Z", now)).toBe(1); // ~1.75 days → 1
    expect(anchorAgeDays("2026-07-27T00:00:00Z", now)).toBe(0);
  });
  it("null / future / unparseable → 0 or null", () => {
    expect(anchorAgeDays(null, now)).toBeNull();
    expect(anchorAgeDays("2026-08-01T00:00:00Z", now)).toBe(0); // future clamps to 0
    expect(anchorAgeDays("not-a-date", now)).toBeNull();
  });
});

describe("computeVariance — new count vs prev + intervening ledger (L8)", () => {
  it("variance = newCount − (prev + received − consumed)", () => {
    // prev 300, +100 received, −80 consumed → predicted 320; counted 310 → −10 (shrinkage).
    const r = computeVariance({ skuId: "cap", newCountOz: 310, prevCountOz: 300, receivedBetweenOz: 100, consumedBetweenOz: 80 });
    expect(r.predictedOz).toBe(320);
    expect(r.varianceOz).toBe(-10);
  });

  it("positive variance (counted more than predicted — an uncounted receipt)", () => {
    const r = computeVariance({ skuId: "cap", newCountOz: 340, prevCountOz: 300, receivedBetweenOz: 100, consumedBetweenOz: 80 });
    expect(r.varianceOz).toBe(20);
  });

  it("no prior count → advisory null", () => {
    const r = computeVariance({ skuId: "cap", newCountOz: 310, prevCountOz: null, receivedBetweenOz: 100, consumedBetweenOz: 80 });
    expect(r.varianceOz).toBeNull();
    expect(r.predictedOz).toBeNull();
  });

  it("missing derive side → advisory null", () => {
    const r = computeVariance({ skuId: "cap", newCountOz: 310, prevCountOz: 300, receivedBetweenOz: null, consumedBetweenOz: 80 });
    expect(r.varianceOz).toBeNull();
  });
});

describe("chainLabelsInWalkOrder — root→leaf for the level picker", () => {
  it("orders case → log (root first)", () => {
    expect(chainLabelsInWalkOrder(capChain)).toEqual(["case", "log"]);
  });
  it("depth-1 tub", () => {
    expect(chainLabelsInWalkOrder(tubChain)).toEqual(["tub"]);
  });
  it("empty chain → []", () => {
    expect(chainLabelsInWalkOrder([])).toEqual([]);
  });
  it("malformed (no unique root) falls back to display order", () => {
    const twoRoots: PackChainLevel[] = [
      { id: "a", label: "box", containsQty: 16, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
      { id: "b", label: "case", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 0 },
    ];
    expect(chainLabelsInWalkOrder(twoRoots)).toEqual(["case", "box"]); // display_ordinal 0,1
  });
});
