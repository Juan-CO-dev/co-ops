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
  resolvePerSkuAnchors,
  computeOnHand,
  computeVariance,
  anchorAgeDays,
  chainLabelsInWalkOrder,
  type CountLineForAnchor,
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

  it("bad qty (negative) fails loudly", () => {
    const r = resolveCountLineOz({ levelLabel: "case", qty: -1, partialFraction: null }, capSku, MEASURES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_qty");
  });

  it("F3: a ZERO qty fails loudly (a zero-qty line counts nothing / can't anchor)", () => {
    const r = resolveCountLineOz({ levelLabel: "case", qty: 0, partialFraction: null }, capSku, MEASURES);
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

  it("F3: a zero-qty line fails the whole batch (qty floor)", () => {
    const lines: CountLineInput[] = [{ skuId: "cap", levelLabel: "case", qty: 0, isLoose: false, partialFraction: null }];
    const res = resolveCountLines(lines, skuById, MEASURES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_qty");
  });
});

describe("resolvePerSkuAnchors — F1: events are sessions, anchors are per-SKU", () => {
  // Three events at ONE location:
  //   E1 (oldest): counts CAP=100 and TUB=50   ← the full session
  //   E2 (middle): SPOT count of CAP=120 only   ← must NOT strand TUB
  //   E3 (newest): SPOT count of CAP=130 only
  const mk = (
    countEventId: string,
    eventCountedAt: string,
    skuId: string,
    resolvedOz: number,
    extra?: Partial<CountLineForAnchor>,
  ): CountLineForAnchor => ({ countEventId, eventCountedAt, skuId, resolvedOz, isLoose: false, partialFraction: null, ...extra });

  const lines: CountLineForAnchor[] = [
    mk("E1", "2026-07-20T10:00:00Z", "cap", 100),
    mk("E1", "2026-07-20T10:00:00Z", "tub", 50),
    mk("E2", "2026-07-23T10:00:00Z", "cap", 120),
    mk("E3", "2026-07-25T10:00:00Z", "cap", 130),
  ];

  it("CAP anchor = newest event (E3=130); prev = E2=120", () => {
    const a = resolvePerSkuAnchors(lines).get("cap")!;
    expect(a.anchorOz).toBe(130);
    expect(a.anchorAt).toBe("2026-07-25T10:00:00Z");
    expect(a.prevOz).toBe(120);
    expect(a.prevAt).toBe("2026-07-23T10:00:00Z");
  });

  it("a spot count of CAP does NOT strand TUB — TUB anchor stays E1=50 with NO prev", () => {
    const a = resolvePerSkuAnchors(lines).get("tub")!;
    expect(a.anchorOz).toBe(50);
    expect(a.anchorAt).toBe("2026-07-20T10:00:00Z"); // TUB's own last count, not E3.
    expect(a.prevOz).toBeNull(); // TUB counted once → first-count → variance advisory.
    expect(a.prevAt).toBeNull();
  });

  it("disjoint anchor lines sum, and loose/partial line counts surface (F6)", () => {
    const disjoint: CountLineForAnchor[] = [
      mk("E1", "2026-07-20T10:00:00Z", "cap", 272), // 2 full cases
      mk("E1", "2026-07-20T10:00:00Z", "cap", 102, { isLoose: true }), // 3 loose logs
      mk("E1", "2026-07-20T10:00:00Z", "cap", 16, { partialFraction: 0.5 }), // half a tub
    ];
    const a = resolvePerSkuAnchors(disjoint).get("cap")!;
    expect(a.anchorOz).toBe(390); // 272 + 102 + 16
    expect(a.looseLineCount).toBe(1);
    expect(a.partialLineCount).toBe(1);
  });

  it("newest event wins regardless of insertion order (ranks by counted_at)", () => {
    const scrambled: CountLineForAnchor[] = [
      mk("E3", "2026-07-25T10:00:00Z", "cap", 130),
      mk("E1", "2026-07-20T10:00:00Z", "cap", 100),
      mk("E2", "2026-07-23T10:00:00Z", "cap", 120),
    ];
    const a = resolvePerSkuAnchors(scrambled).get("cap")!;
    expect(a.anchorOz).toBe(130);
    expect(a.prevOz).toBe(120);
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

  it("F2: a SKU with no prior count → advisory null, NEVER 0 (first count)", () => {
    const r = computeVariance({ skuId: "cap", newCountOz: 310, prevCountOz: null, receivedBetweenOz: 100, consumedBetweenOz: 80 });
    expect(r.varianceOz).toBeNull(); // must be null (advisory), not a fabricated 0.
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
