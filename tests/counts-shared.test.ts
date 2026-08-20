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
  resolveCountLineDim,
  resolveCountLinesDim,
  sumAnchorOzBySku,
  resolvePerSkuAnchors,
  reconcileAnchorDimensions,
  computeOnHand,
  computeOnHandUnits,
  computeVariance,
  computeUsedOrLost,
  computeInferredBaselineOz,
  anchorAgeDays,
  chainLabelsInWalkOrder,
  twinVendorLabels,
  type CountSkuVendorLabel,
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
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 136, consumedSinceOz: 100, anchorStale: false, anchorSource: "census" },
      now,
    );
    expect(r.driftOz).toBe(36); // 136 − 100
    expect(r.onHandOz).toBe(410); // 374 + 36
    expect(r.anchorAgeDays).toBe(2);
  });

  it("null received → null drift → null on-hand (advisory, never fabricated)", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: null, consumedSinceOz: 100, anchorStale: false, anchorSource: "census" },
      now,
    );
    expect(r.driftOz).toBeNull();
    expect(r.onHandOz).toBeNull();
  });

  it("null consumed → null drift → null on-hand", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 136, consumedSinceOz: null, anchorStale: false, anchorSource: "census" },
      now,
    );
    expect(r.driftOz).toBeNull();
    expect(r.onHandOz).toBeNull();
  });

  it("never-counted SKU (null anchor) → null on-hand even with clean drift", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: null, anchorAt: null, receivedSinceOz: 136, consumedSinceOz: 100, anchorStale: false, anchorSource: null },
      now,
    );
    expect(r.driftOz).toBe(36);
    expect(r.onHandOz).toBeNull();
    expect(r.anchorAgeDays).toBeNull();
  });

  it("carries the retro-edit staleness flag through", () => {
    const r = computeOnHand(
      { skuId: "cap", anchorOz: 100, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 0, consumedSinceOz: 0, anchorStale: true, anchorSource: "census" },
      now,
    );
    expect(r.anchorStale).toBe(true);
  });

  it("carries anchorSource through UNTOUCHED (display provenance) and the math stays source-blind", () => {
    // Identical numeric inputs, only anchorSource differs → identical math, differing provenance.
    // All THREE truth tiers (census > par_estimate > inferred) drift by the SAME formula.
    const base = { skuId: "cap", anchorOz: 374, anchorAt: "2026-07-25T12:00:00Z", receivedSinceOz: 136, consumedSinceOz: 100, anchorStale: false } as const;
    const census = computeOnHand({ ...base, anchorSource: "census" }, now);
    const parEstimate = computeOnHand({ ...base, anchorSource: "par_estimate" }, now);
    const inferred = computeOnHand({ ...base, anchorSource: "inferred" }, now);
    expect(census.anchorSource).toBe("census");
    expect(parEstimate.anchorSource).toBe("par_estimate");
    expect(inferred.anchorSource).toBe("inferred");
    // Source is display-only: the numbers must be byte-identical regardless of provenance.
    expect(census.onHandOz).toBe(parEstimate.onHandOz);
    expect(census.onHandOz).toBe(inferred.onHandOz);
    expect(census.driftOz).toBe(parEstimate.driftOz);
    expect(census.driftOz).toBe(inferred.driftOz);
    expect(census.onHandOz).toBe(410);
  });
});

// ── Inference bootstrap (spec D6; WINDOW_DAYS=28, COVERAGE_DAYS=7) ──────────────
// computeInferredBaselineOz gives an on-hand cold-start from consumption run-rate:
// dailyAvg = totalConsumedOz / windowDays (CALENDAR window), inferredOz = dailyAvg
// × coverageDays. Null when there's no positive, finite consumption to run-rate
// from (advisory-null law — zero-consumption SKUs get NO baseline, never fabricated).
describe("computeInferredBaselineOz — consumption run-rate baseline (D6)", () => {
  it("280 oz over 28d → dailyAvg 10, inferred 70 (7 coverage days)", () => {
    const r = computeInferredBaselineOz(280);
    expect(r).not.toBeNull();
    expect(r!.dailyAvgOz).toBe(10); // 280 / 28
    expect(r!.inferredOz).toBe(70); // 10 × 7
  });

  it("zero consumption → null (no baseline; advisory-null stays)", () => {
    expect(computeInferredBaselineOz(0)).toBeNull();
  });

  it("negative total → null (never fabricate from garbage)", () => {
    expect(computeInferredBaselineOz(-5)).toBeNull();
  });

  it("non-finite total (NaN / Infinity) → null", () => {
    expect(computeInferredBaselineOz(Number.NaN)).toBeNull();
    expect(computeInferredBaselineOz(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("respects custom window/coverage params (calendar window normalization)", () => {
    // 140 oz over a 14d window = 10/day; cover 3 days → 30 oz.
    const r = computeInferredBaselineOz(140, 14, 3);
    expect(r!.dailyAvgOz).toBe(10);
    expect(r!.inferredOz).toBe(30);
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

// ── PR-C: dimension-aware resolution + count-space on-hand / used-or-lost ────────
describe("PR-C count-anchored resolution (resolveCountLineDim / resolveCountLinesDim)", () => {
  // A packaging count chain: case -> 12 each (bare count leaf, no size/avg).
  const lidChain: PackChainLevel[] = [
    { id: "case", label: "case", containsQty: 12, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0 },
  ];
  const lidSku: RecipeInputSku = {
    packFormat: "Case", eachContainerLabel: null,
    unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
    packChain: lidChain,
  };

  it("raw oz chain anchors in WEIGHT (unchanged) — cap case = 136 oz", () => {
    const r = resolveCountLineDim({ levelLabel: "case", qty: 1, partialFraction: null }, capSku, MEASURES);
    expect(r).toEqual({ ok: true, dimension: "weight", oz: 136 });
  });

  it("count-terminated chain anchors in COUNT — 2 cases of 12 = 24 units", () => {
    const r = resolveCountLineDim({ levelLabel: "case", qty: 2, partialFraction: null }, lidSku, MEASURES);
    expect(r).toEqual({ ok: true, dimension: "count", units: 24 });
  });

  it("count line at the leaf level — 3 loose 'each' = 3 units", () => {
    // The leaf itself is a chain label only if named; here the level 'each' is the
    // leaf's measure, not a chain-level label, so a loose count is entered at 'case'
    // fractionally OR the picker offers 'case'. A partial fraction scales leaf units.
    const r = resolveCountLineDim({ levelLabel: "case", qty: 1, partialFraction: 0.25 }, lidSku, MEASURES);
    expect(r).toEqual({ ok: true, dimension: "count", units: 3 }); // 12 × 0.25
  });

  it("no chain / not count-terminated → unresolvable (rejected loudly)", () => {
    const noChain: RecipeInputSku = { ...lidSku, packChain: null };
    expect(resolveCountLineDim({ levelLabel: "case", qty: 1, partialFraction: null }, noChain, MEASURES).ok).toBe(false);
  });

  it("bad qty is a hard failure in either dimension", () => {
    const r = resolveCountLineDim({ levelLabel: "case", qty: 0, partialFraction: null }, lidSku, MEASURES);
    expect(r).toEqual({ ok: false, reason: "bad_qty" });
  });

  it("batch resolveCountLinesDim: mixed weight + count lines persist their dimensions", () => {
    const lines: CountLineInput[] = [
      { skuId: "cap", levelLabel: "case", qty: 1, isLoose: false, partialFraction: null }, // weight
      { skuId: "lid", levelLabel: "case", qty: 2, isLoose: false, partialFraction: null }, // count
    ];
    const skuMap = new Map<string, RecipeInputSku>([["cap", capSku], ["lid", lidSku]]);
    const r = resolveCountLinesDim(lines, skuMap, MEASURES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resolved[0]).toMatchObject({ anchorDimension: "weight", resolvedOz: 136, resolvedUnits: null });
    expect(r.resolved[1]).toMatchObject({ anchorDimension: "count", resolvedOz: null, resolvedUnits: 24 });
  });

  it("batch rejects the whole event on an unresolvable line", () => {
    const lines: CountLineInput[] = [{ skuId: "x", levelLabel: "case", qty: 1, isLoose: false, partialFraction: null }];
    const skuMap = new Map<string, RecipeInputSku>([["x", { ...lidSku, packChain: null }]]);
    const r = resolveCountLinesDim(lines, skuMap, MEASURES);
    expect(r.ok).toBe(false);
  });
});

describe("PR-C count-space on-hand + used-or-lost", () => {
  const NOW = Date.parse("2026-07-28T12:00:00Z");

  it("computeOnHandUnits: anchor + received-since (no consumed term)", () => {
    const r = computeOnHandUnits(
      { skuId: "lid", anchorUnits: 24, anchorAt: "2026-07-20T12:00:00Z", receivedUnitsSince: 12, anchorStale: false },
      NOW,
    );
    expect(r.onHandUnits).toBe(36);
    expect(r.anchorAgeDays).toBe(8);
  });

  it("computeOnHandUnits: null intake → advisory null (never fabricated)", () => {
    const r = computeOnHandUnits(
      { skuId: "lid", anchorUnits: 24, anchorAt: "2026-07-20T12:00:00Z", receivedUnitsSince: null, anchorStale: false },
      NOW,
    );
    expect(r.onHandUnits).toBeNull();
  });

  it("computeUsedOrLost: (prev + received) − new, POSITIVE = used or lost", () => {
    // Prior count 30, received 12 between, new count 27 → 15 used or lost.
    const r = computeUsedOrLost({ skuId: "lid", newCountUnits: 27, prevCountUnits: 30, receivedBetweenUnits: 12 });
    expect(r.usedOrLostUnits).toBe(15);
  });

  it("computeUsedOrLost: no prior count → advisory null (not zero)", () => {
    const r = computeUsedOrLost({ skuId: "lid", newCountUnits: 27, prevCountUnits: null, receivedBetweenUnits: 12 });
    expect(r.usedOrLostUnits).toBeNull();
  });
});

// ── reconcileAnchorDimensions (adversarial review 2026-07-28 HIGH) ─────────────
// A SKU whose chain flipped dimension between counts has anchors in BOTH maps;
// without reconciliation it renders TWICE (duplicate React key, contradictory
// on-hand). Latest anchor wins ACROSS dimensions — one row per SKU, always.
describe("reconcileAnchorDimensions", () => {
  const w = (anchorAt: string) => ({ anchorAt });

  it("weight→count flip: fresher COUNT anchor evicts the stale weight anchor", () => {
    const weight = new Map([["gloves", w("2026-07-20T12:00:00Z")]]);
    const count = new Map([["gloves", w("2026-07-27T12:00:00Z")]]);
    reconcileAnchorDimensions(weight, count);
    expect(weight.has("gloves")).toBe(false);
    expect(count.has("gloves")).toBe(true);
  });

  it("count→weight flip: fresher WEIGHT anchor evicts the stale count anchor", () => {
    const weight = new Map([["capicola", w("2026-07-27T12:00:00Z")]]);
    const count = new Map([["capicola", w("2026-07-20T12:00:00Z")]]);
    reconcileAnchorDimensions(weight, count);
    expect(weight.has("capicola")).toBe(true);
    expect(count.has("capicola")).toBe(false);
  });

  it("tie keeps COUNT (the newer write path — a same-instant flip terminates count-space)", () => {
    const weight = new Map([["lids", w("2026-07-27T12:00:00Z")]]);
    const count = new Map([["lids", w("2026-07-27T12:00:00Z")]]);
    reconcileAnchorDimensions(weight, count);
    expect(weight.has("lids")).toBe(false);
    expect(count.has("lids")).toBe(true);
  });

  it("disjoint SKUs are untouched (no flip → no eviction)", () => {
    const weight = new Map([["ham", w("2026-07-27T12:00:00Z")]]);
    const count = new Map([["gloves", w("2026-07-20T12:00:00Z")]]);
    reconcileAnchorDimensions(weight, count);
    expect(weight.has("ham")).toBe(true);
    expect(count.has("gloves")).toBe(true);
  });
});

// ── twinVendorLabels (multi-vendor audit P8) ──────────────────────────────────
describe("twinVendorLabels", () => {
  const o = (id: string, name: string, vendorName: string | null): CountSkuVendorLabel =>
    ({ id, name, vendorName });

  it("labels both sides when one name exists under two vendors", () => {
    // The live case: two identical "Ham" rows in the count dropdown.
    const m = twinVendorLabels([o("h1", "Ham", "Baldor"), o("h2", "Ham", "PFG")]);
    expect(m.get("h1")).toBe("Baldor");
    expect(m.get("h2")).toBe("PFG");
  });

  it("labels nothing in a single-vendor catalog (the ~95% case)", () => {
    const m = twinVendorLabels([o("a", "Ham", "Baldor"), o("b", "Turkey", "Baldor")]);
    expect(m.size).toBe(0);
  });

  it("does not label a same-vendor duplicate — the vendor disambiguates nothing", () => {
    const m = twinVendorLabels([o("a", "Ham", "Baldor"), o("b", "Ham", "Baldor")]);
    expect(m.size).toBe(0);
  });

  it("compares names case-insensitively and trimmed", () => {
    const m = twinVendorLabels([o("a", "  ham ", "Baldor"), o("b", "HAM", "PFG")]);
    expect(m.get("a")).toBe("Baldor");
    expect(m.get("b")).toBe("PFG");
  });

  it("counts an unassigned SKU as ambiguity but never labels it", () => {
    // No honest vendor to name — inventing one would be worse than the ambiguity.
    const m = twinVendorLabels([o("a", "Sub Roll", null), o("b", "Sub Roll", "Baldor")]);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe("Baldor");
  });

  it("labels nothing when every match is unassigned", () => {
    expect(twinVendorLabels([o("a", "Sub Roll", null), o("b", "Sub Roll", null)]).size).toBe(0);
  });

  it("handles an empty option set", () => {
    expect(twinVendorLabels([]).size).toBe(0);
  });

  it("labels three-way twins", () => {
    const m = twinVendorLabels([o("a", "Ham", "V1"), o("b", "Ham", "V2"), o("c", "Ham", "V3")]);
    expect([...m.values()].sort()).toEqual(["V1", "V2", "V3"]);
  });
});
