/**
 * Unit spine — lib/angel-wave2.ts (the Angel HARVEST → pack-price math, wave 2).
 *
 * Wave 1's tests guard the divisor. These guard three things wave 1 never had to:
 *
 *  1. COUNT-space scaling, where our pack is BIGGER than Angel's. The Sub Roll case
 *     lands exactly on a half-cent (787 x 30 / 12 = 1967.5), and the naive dollar
 *     form `7.87 / 0.4` floats to 19.674999999999997 and rounds a cent LOW. If the
 *     integer-cent path ever regresses to dollar division, every sandwich's roll
 *     cost is silently one cent under. That test is the whole reason the function
 *     is written the way it is.
 *
 *  2. The weight-trust classifier and the dropped-multiplier detector — the two
 *     rules that stand between us and Angel's two known data bugs. A regression
 *     here does not throw; it just quietly lets a fabricated 1.0-lb weight or a
 *     6x-inflated $/lb through into real cost data.
 *
 *  3. The conflict-impact split. Calling a PACK_AGREES weight disagreement
 *     "price in doubt" needlessly withholds a correct price; calling a
 *     CASE_MULTIPLE one "weight only" propagates a bad divisor. The direction of
 *     that single boolean decides which mistake we make.
 */
import { describe, it, expect } from "vitest";
import {
  parseAngelRollup, rollupKey, parseAngelDate,
  classifyWeightSource, packVsActualRatio, isMaterialDisagreement, detectDroppedMultiplier,
  centsFromUsd, scalePriceByCount, priceFromPerLb,
  parseCountPack, conflictImpact, resweepRule, priceMovements,
  CARDINAL_SUB_ROLL, DELMAR_CATCH_WEIGHT_RULES, DISAGREEMENT_TOLERANCE,
  type RollupRow,
} from "@/lib/angel-wave2";
import { DIVISION_RULES, type DivisionRule } from "@/lib/angel-price-fill";

function rollup(over: Partial<RollupRow> = {}): RollupRow {
  return {
    product: "X", brand: "B", manufacturer: "M", vendor: "PFG", packSize: "1/5 LB",
    purchaseLines: 3, totalQty: 10, totalSpend: 100, latestPricePerLb: 2,
    pplMin: 2, pplMax: 2, unitPriceMin: 10, unitPriceMax: 10,
    lbsPerUnitMin: 5, lbsPerUnitMax: 5, weightSource: "invoice_catch_weight",
    firstSeen: "Jul 10, 2026", lastSeen: "Aug 14, 2026", ...over,
  };
}

function ruleNamed(product: string): DivisionRule {
  const r = DIVISION_RULES.find((d) => d.product === product);
  if (!r) throw new Error(`test fixture: no DIVISION_RULES entry for ${product}`);
  return r;
}

// ── The Sub Roll arithmetic (the half-cent trap) ────────────────────────────────

describe("scalePriceByCount", () => {
  it("prices the real Sub Roll case correctly across the half-cent tie", () => {
    // 12 rolls at $7.87 -> our flat of 30 rolls. 787 x 30 / 12 = 1967.5 cents.
    const r = scalePriceByCount(7.87, 12, 30);
    expect(r.exactCents).toBe(1967.5);
    expect(r.unitPrice).toBe(19.68); // half-UP, not 19.67
    expect(r.rounded).toBe(true);
    expect(r.ourUnitsPerAngelUnit).toBe(2.5);
  });

  it("survives a half-cent tie the dollar-division path loses", () => {
    // Today's $7.87 happens to be safe in either form, so it cannot prove the
    // point. Move the price a few cents at the SAME 12-to-30 ratio and the dollar
    // path breaks: 8.19 / (12/30) floats to 20.474999999999998 and rounds DOWN,
    // where the true value 2047.5 cents rounds half-up to $20.48. Cardinal will
    // re-price eventually; this is the row that must not silently lose a cent.
    const dollarPath = Math.round(Number(`${8.19 / (12 / 30)}e2`)) / 100;
    expect(dollarPath).toBe(20.47); // the wrong answer

    const r = scalePriceByCount(8.19, 12, 30);
    expect(r.exactCents).toBe(2047.5);
    expect(r.unitPrice).toBe(20.48); // the right one
  });

  it("is exact when the counts divide evenly", () => {
    const r = scalePriceByCount(7.87, 12, 12);
    expect(r.unitPrice).toBe(7.87);
    expect(r.rounded).toBe(false);
    expect(r.ourUnitsPerAngelUnit).toBe(1);
  });

  it("scales down when our pack is smaller than Angel's", () => {
    expect(scalePriceByCount(24.0, 24, 6).unitPrice).toBe(6.0);
  });

  it("throws rather than emitting a nonsense price", () => {
    expect(() => scalePriceByCount(0, 12, 30)).toThrow();
    expect(() => scalePriceByCount(7.87, 0, 30)).toThrow();
    expect(() => scalePriceByCount(7.87, 12, 0)).toThrow();
    expect(() => scalePriceByCount(7.87, 12.5, 30)).toThrow(); // counts must be integers
    expect(() => scalePriceByCount(Number.NaN, 12, 30)).toThrow();
  });
});

describe("centsFromUsd", () => {
  it("is decimal-exact where multiply-by-100 is not", () => {
    expect(1.005 * 100).toBeLessThan(100.5); // the IEEE-754 artifact
    expect(centsFromUsd(1.005)).toBe(101);
    expect(centsFromUsd(7.87)).toBe(787);
    expect(centsFromUsd(70.35)).toBe(7035);
  });
});

// ── Catch-weight pricing ───────────────────────────────────────────────────────

describe("priceFromPerLb", () => {
  it("prices the Bacon case from $/lb x our pack lb", () => {
    // Our chain: case -> 240 oz = 15 lb. Angel: $4.69/lb.
    const r = priceFromPerLb(4.69, 240);
    expect(r.ourPackLb).toBe(15);
    expect(r.unitPrice).toBe(70.35);
  });

  it("agrees with Angel's own observed case price for that row", () => {
    // Independent corroboration: Angel's unit_price for IMP LAYER BACON is $70.35.
    expect(priceFromPerLb(4.69, 240).unitPrice).toBe(70.35);
  });

  it("throws on a non-positive $/lb or pack oz", () => {
    expect(() => priceFromPerLb(0, 240)).toThrow();
    expect(() => priceFromPerLb(4.69, 0)).toThrow();
  });
});

// ── Weight trust ───────────────────────────────────────────────────────────────

describe("classifyWeightSource", () => {
  it("trusts only the invoice catch weight", () => {
    expect(classifyWeightSource("invoice_catch_weight")).toBe("MEASURED");
    expect(classifyWeightSource("assumed_default_1lb")).toBe("ASSUMED");
    expect(classifyWeightSource("unknown")).toBe("UNKNOWN");
    expect(classifyWeightSource("")).toBe("UNKNOWN");
  });

  it("treats any assumed_* variant as ASSUMED (the fabrication family)", () => {
    expect(classifyWeightSource("assumed_default_2lb")).toBe("ASSUMED");
  });
});

// ── The two Angel bugs ─────────────────────────────────────────────────────────

describe("detectDroppedMultiplier", () => {
  it("catches the chive shaker at exactly 1/6", () => {
    // 0.07 lb recorded for a 6 x 1.12 oz case = 0.42 lb nominal.
    const ratio = packVsActualRatio(0.07 * 16, 0.42 * 16);
    expect(detectDroppedMultiplier(ratio)).toBe(6);
  });

  it("does NOT fire on a genuine catch-weight wobble", () => {
    // London Broil is the widest real variance in the dataset.
    expect(detectDroppedMultiplier(packVsActualRatio(6.87 * 16, 6.55 * 16))).toBeNull();
    expect(detectDroppedMultiplier(1.2)).toBeNull(); // over-weight, not under
    expect(detectDroppedMultiplier(0.9)).toBeNull(); // 1/1.11 — not a clean 1/N
  });

  it("is null on missing or degenerate input", () => {
    expect(detectDroppedMultiplier(null)).toBeNull();
    expect(detectDroppedMultiplier(0)).toBeNull();
    expect(detectDroppedMultiplier(1)).toBeNull();
  });
});

describe("packVsActualRatio / isMaterialDisagreement", () => {
  it("flags the PFG 1/5 LB -> 6.00 lb family", () => {
    const ratio = packVsActualRatio(96, 80);
    expect(ratio).toBeCloseTo(1.2, 5);
    expect(isMaterialDisagreement(ratio)).toBe(true);
  });

  it("passes a clean agreement", () => {
    expect(isMaterialDisagreement(packVsActualRatio(160.4, 160))).toBe(false);
  });

  it("is loudly-null rather than wrong on missing input", () => {
    expect(packVsActualRatio(null, 80)).toBeNull();
    expect(packVsActualRatio(96, null)).toBeNull();
    expect(packVsActualRatio(0, 80)).toBeNull();
    expect(isMaterialDisagreement(null)).toBe(false);
  });

  it("uses the harvest's 15% threshold", () => {
    expect(DISAGREEMENT_TOLERANCE).toBe(0.15);
    expect(isMaterialDisagreement(1.15)).toBe(false);
    expect(isMaterialDisagreement(1.16)).toBe(true);
  });
});

// ── The conflict-impact split (the direction that decides which mistake we make) ─

describe("conflictImpact", () => {
  it("puts the PRICE in doubt only when the divisor came from the contradicted pack string", () => {
    expect(conflictImpact(ruleNamed("ONION PWDR"))).toBe("PRICE_IN_DOUBT"); // CASE_MULTIPLE
    expect(conflictImpact(ruleNamed("GARLIC WHL PLD DOM"))).toBe("PACK_WEIGHT_ONLY"); // PACK_AGREES
  });
});

describe("resweepRule", () => {
  it("refuses an assumed weight before looking at any ratio", () => {
    const f = resweepRule(ruleNamed("BASIL FRSH"), rollup({ weightSource: "assumed_default_1lb", lbsPerUnitMin: 1, lbsPerUnitMax: 1 }), false);
    expect(f.code).toBe("ASSUMED_WEIGHT");
    expect(f.ratio).toBeNull(); // never computed from a fabricated weight
  });

  it("reports agreement as a finding with no code (independent corroboration)", () => {
    const rule = ruleNamed("HAM 35% WATER FC 4X6 TFF"); // angelCaseOz 208
    const f = resweepRule(rule, rollup({ lbsPerUnitMin: 12.98, lbsPerUnitMax: 13.02 }), true);
    expect(f.code).toBeNull();
    expect(f.wasWave1Fill).toBe(true);
    expect(f.ratio).toBeCloseTo(1, 2);
  });

  it("flags a CASE_MULTIPLE disagreement as price-in-doubt", () => {
    const rule = ruleNamed("ONION PWDR"); // angelCaseOz 80, divisor 5
    const f = resweepRule(rule, rollup({ lbsPerUnitMin: 6, lbsPerUnitMax: 6 }), true);
    expect(f.code).toBe("MATERIAL_DISAGREEMENT");
    expect(f.impact).toBe("PRICE_IN_DOUBT");
  });

  it("flags a PACK_AGREES disagreement as weight-only", () => {
    const rule = ruleNamed("GARLIC WHL PLD DOM"); // angelCaseOz 80, divisor 1
    const f = resweepRule(rule, rollup({ lbsPerUnitMin: 6, lbsPerUnitMax: 6 }), true);
    expect(f.code).toBe("MATERIAL_DISAGREEMENT");
    expect(f.impact).toBe("PACK_WEIGHT_ONLY");
  });

  it("handles a missing rollup row without inventing a weight", () => {
    const f = resweepRule(ruleNamed("BASIL FRSH"), null, false);
    expect(f.code).toBe("NO_MEASURED_WEIGHT");
    expect(f.measuredCaseOz).toBeNull();
  });
});

// ── Parsing ────────────────────────────────────────────────────────────────────

describe("parseCountPack", () => {
  it("parses the Cardinal pack string", () => {
    expect(parseCountPack("12 ct")).toBe(12);
    expect(parseCountPack("12ct")).toBe(12);
    expect(parseCountPack("250 EA")).toBe(250);
  });

  it("refuses anything that is not a bare count (a mis-parse is a wrong price)", () => {
    expect(parseCountPack("1/5 LB")).toBeNull();
    expect(parseCountPack("6/66.5 OZ")).toBeNull();
    expect(parseCountPack("")).toBeNull();
    expect(parseCountPack("12")).toBeNull();
    expect(parseCountPack("0 ct")).toBeNull();
  });
});

describe("parseAngelDate", () => {
  it("converts Angel's display date to ISO", () => {
    expect(parseAngelDate("Aug 13, 2026")).toBe("2026-08-13");
    expect(parseAngelDate("Jul 10, 2026")).toBe("2026-07-10");
    expect(parseAngelDate("December 1, 2026")).toBe("2026-12-01");
  });

  it("returns null rather than guessing", () => {
    expect(parseAngelDate("2026-08-13")).toBeNull();
    expect(parseAngelDate("Xxx 13, 2026")).toBeNull();
    expect(parseAngelDate("")).toBeNull();
  });
});

describe("parseAngelRollup", () => {
  const csv = [
    "product,brand,manufacturer,vendor,pack_size,purchase_lines,total_qty,total_spend,latest_price_per_lb,ppl_min,ppl_max,unit_price_min,unit_price_max,lbs_per_unit_min,lbs_per_unit_max,weight_source,first_seen,last_seen",
    'OVENGOLD TURKEY,—,—,Delmar Provisions,—,3,136.0,7913.31,6.29,6.29,6.29,57.6094,58.4821,9.1589,9.2976,invoice_catch_weight,"Jul 10, 2026","Aug 10, 2026"',
    'Large Hero Hearth,—,—,Cardinal Bakery,12 ct,1,20.0,157.4,,,,7.87,7.87,,,unknown,"Aug 13, 2026","Aug 13, 2026"',
  ].join("\n");

  it("is header-driven and reads Angel's em-dash null as null", () => {
    const rows = parseAngelRollup(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.product).toBe("OVENGOLD TURKEY");
    expect(rows[0]!.lbsPerUnitMin).toBe(9.1589);
    // The em-dash is Angel's null marker, not a brand.
    expect(rows[1]!.latestPricePerLb).toBeNull();
    expect(rows[1]!.lbsPerUnitMin).toBeNull();
    expect(rows[1]!.packSize).toBe("12 ct");
    expect(rows[1]!.unitPriceMax).toBe(7.87);
  });

  it("throws on a missing column rather than silently mis-indexing", () => {
    expect(() => parseAngelRollup("product,vendor\nA,PFG")).toThrow(/pack_size|brand/);
  });

  it("builds a key joinable with wave 1's rowKey", () => {
    const rows = parseAngelRollup(csv);
    expect(rollupKey(rows[0]!)).toBe("OVENGOLD TURKEY | — | Delmar Provisions | —");
  });
});

// ── Price movement ─────────────────────────────────────────────────────────────

describe("priceMovements", () => {
  it("excludes rows whose $/lb is a case price in disguise", () => {
    const moved = rollup({ product: "MOVED", pplMin: 2, pplMax: 3, totalSpend: 50 });
    const fake = rollup({ product: "FAKE", pplMin: 2, pplMax: 3, totalSpend: 900, weightSource: "assumed_default_1lb" });
    const out = priceMovements([moved, fake]);
    expect(out.map((m) => m.row.product)).toEqual(["MOVED"]);
  });

  it("excludes flat prices and sorts by spend", () => {
    const flat = rollup({ product: "FLAT", pplMin: 2, pplMax: 2 });
    const small = rollup({ product: "SMALL", pplMin: 1, pplMax: 2, totalSpend: 10 });
    const big = rollup({ product: "BIG", pplMin: 1, pplMax: 1.1, totalSpend: 999 });
    const out = priceMovements([flat, small, big]);
    expect(out.map((m) => m.row.product)).toEqual(["BIG", "SMALL"]);
    expect(out[1]!.changeFraction).toBeCloseTo(1, 5);
  });
});

// ── The transcribed tables ─────────────────────────────────────────────────────

describe("wave-2 source tables", () => {
  it("holds the Cardinal row exactly as harvested, and it reconciles", () => {
    expect(CARDINAL_SUB_ROLL.countPerAngelPack).toBe(parseCountPack(CARDINAL_SUB_ROLL.packSize));
    // 20 x $7.87 = $157.40, matching the invoice line total.
    expect(CARDINAL_SUB_ROLL.qtyPurchased * CARDINAL_SUB_ROLL.unitPriceUsd).toBeCloseTo(CARDINAL_SUB_ROLL.lineTotalUsd, 5);
  });

  it("maps exactly the 8 measured Delmar products, with one flagged inference", () => {
    expect(DELMAR_CATCH_WEIGHT_RULES).toHaveLength(8);
    const inferred = DELMAR_CATCH_WEIGHT_RULES.filter((r) => r.confidence === "INFERRED");
    expect(inferred.map((r) => r.product)).toEqual(["LONDON BROIL"]);
    // No duplicate targets — two Angel rows pricing one SKU would be a silent contest.
    const names = DELMAR_CATCH_WEIGHT_RULES.map((r) => r.skuName);
    expect(new Set(names).size).toBe(names.length);
  });
});
