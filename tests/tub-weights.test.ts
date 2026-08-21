/**
 * Unit spine — lib/tub-weights.ts (wave 5, Juan's shop-floor tub readings).
 *
 * Four things in this module fail SILENTLY if they drift, and each is pinned
 * below:
 *
 *  1. **The evidence class must never fall back.** `--evidence-class` answers one
 *     question — label or scale — and a typo that silently resolved to the
 *     default would stamp SPEC onto a run the operator believed was writing
 *     OPERATIONAL. Wave 3 measured that gap at 20-60%. So the parser throws, and
 *     the throw is tested from both directions.
 *
 *  2. **The disposition ladder's ORDER is the policy.** `CONFIRMS_LIVE` has to
 *     outrank `CONFLICT_PRESENT_ONLY`, or chili flake — whose reading AGREES with
 *     its live pack — would be reported as a conflict with itself the moment its
 *     pack ever acquires a measured class. Order-dependence that only bites under
 *     a future state is exactly what a test is for.
 *
 *  3. **The label-vs-measurement discriminator's asymmetric tolerances.** A pack
 *     string is a printed figure and a measurement is a distribution. Using one
 *     tolerance for both makes the discriminator answer NEITHER on every row, and
 *     it would still look like it was working.
 *
 *  4. **A pack-content change must NOT be mistaken for a price change.** Wave 3
 *     §C moved a DIVISOR and had to supersede the price row; wave 5 moves what a
 *     pack CONTAINS and must not. `packRecostEffect` encodes the distinction and
 *     `priceRowUnchanged` is asserted on every path.
 *
 * The readings themselves are pinned verbatim because they are the wave's whole
 * evidence, and because a quote that drifts is a quote nobody can audit.
 */
import { describe, it, expect } from "vitest";
import {
  JUAN_TUB_READING,
  EVIDENCE_CLASS_QUESTION,
  EVIDENCE_CLASS_DEFAULT,
  EVIDENCE_CLASS_BASIS,
  resolveEvidenceClass,
  classifyReadingAgainstPackString,
  READING_AGREEMENT_MEANING,
  measuredSpreadFraction,
  TUB_READINGS,
  GARLIC_TARE_CONFLICT,
  BILLED_VS_NET_NOTE_CLASS,
  billedVsNetGapOz,
  ONION_POWDER_STILL_GATED,
  disposeTub,
  DISPOSITION_MEANING,
  tubPackOz,
  packRecostEffect,
  WAVE5_REASONS,
  PACK_STRING_TOLERANCE_LBS,
  MEASUREMENT_TOLERANCE_FRACTION,
  type EvidenceClass,
  type ReadingAgreement,
  type TubDisposition,
  type Wave5Code,
} from "@/lib/tub-weights";
import { isMeasuredWeightClass } from "@/lib/angel-wave4";

const bySku = (name: string) => {
  const hit = TUB_READINGS.find((t) => t.skuName === name);
  if (!hit) throw new Error(`no reading for ${name}`);
  return hit;
};

describe("Juan's reading, verbatim", () => {
  it("quotes all five tubs and the completeness clause", () => {
    // The clause matters as much as the numbers: it is a claim about what was
    // VISIBLE, and it is why onion powder is 'not observed' rather than absent.
    expect(JUAN_TUB_READING).toContain("Garlic powder tub is 6 LB");
    expect(JUAN_TUB_READING).toContain("oregano tub is 6 LB");
    expect(JUAN_TUB_READING).toContain("garlic tub is 5 LB");
    expect(JUAN_TUB_READING).toContain("crushed red pepper tub is 4 LB");
    expect(JUAN_TUB_READING).toContain("whole black pepper is 5.75 LB");
    expect(JUAN_TUB_READING).toContain("those are all the tubs I see");
    expect(JUAN_TUB_READING).toContain("Juan 2026-08-21");
  });

  it("carries exactly five readings, each matching the quote's pounds", () => {
    expect(TUB_READINGS).toHaveLength(5);
    for (const t of TUB_READINGS) {
      expect(JUAN_TUB_READING).toContain(t.spoken);
      expect(t.lbs).toBeGreaterThan(0);
      expect(t.vendor).toBe("PFG");
    }
    expect(TUB_READINGS.map((t) => t.lbs)).toEqual([6, 6, 5, 4, 5.75]);
  });

  it("names the SKU for every reading, and justifies every non-verbatim match", () => {
    for (const t of TUB_READINGS) {
      expect(t.skuName.length).toBeGreaterThan(0);
      if (t.nameMatch === "SYNONYM") {
        // A synonym match is a judgement, and an unjustified judgement in a seed
        // is how a weight lands on the wrong SKU.
        expect(t.matchEvidence.length).toBeGreaterThan(80);
      } else {
        expect(t.matchEvidence).toBe("");
      }
    }
    expect(bySku("Chili Flake").nameMatch).toBe("SYNONYM");
    expect(bySku("Black peppercorn").nameMatch).toBe("SYNONYM");
    expect(bySku("Oregano").nameMatch).toBe("VERBATIM");
  });
});

describe("resolveEvidenceClass — one constant, and it never falls back", () => {
  it("defaults to the conservative class when unspecified", () => {
    expect(resolveEvidenceClass(null)).toBe("SPEC");
    expect(resolveEvidenceClass(undefined)).toBe("SPEC");
    expect(resolveEvidenceClass("")).toBe("SPEC");
    expect(EVIDENCE_CLASS_DEFAULT).toBe("SPEC");
  });

  it("accepts both answers, in any casing, with surrounding space", () => {
    expect(resolveEvidenceClass("SPEC")).toBe("SPEC");
    expect(resolveEvidenceClass("operational")).toBe("OPERATIONAL");
    expect(resolveEvidenceClass("  Operational  ")).toBe("OPERATIONAL");
  });

  it("THROWS on anything else rather than silently defaulting", () => {
    // The silent-fallback bug this prevents: `--evidence-class OPERATIONL` would
    // write SPEC and report success.
    expect(() => resolveEvidenceClass("OPERATIONL")).toThrow(/SPEC or OPERATIONAL/);
    expect(() => resolveEvidenceClass("INVOICE_DERIVED")).toThrow();
    expect(() => resolveEvidenceClass("ESTIMATE")).toThrow();
    expect(() => resolveEvidenceClass("scale")).toThrow();
  });

  it("offers only the two classes the question can produce", () => {
    const keys = Object.keys(EVIDENCE_CLASS_BASIS).sort();
    expect(keys).toEqual(["OPERATIONAL", "SPEC"]);
    // Neither offerable class is the vendor's scale or a guess.
    expect(keys).not.toContain("INVOICE_DERIVED");
    expect(keys).not.toContain("ESTIMATE");
    // Both are real WeightClass members, and only one of them is 'measured'.
    expect(isMeasuredWeightClass("OPERATIONAL")).toBe(true);
    expect(isMeasuredWeightClass("SPEC")).toBe(false);
  });

  it("records the question as asked", () => {
    expect(EVIDENCE_CLASS_QUESTION).toContain("SPEC");
    expect(EVIDENCE_CLASS_QUESTION).toContain("OPERATIONAL");
    expect(EVIDENCE_CLASS_QUESTION).toContain("--evidence-class");
  });
});

describe("classifyReadingAgainstPackString — evidence about the READING", () => {
  const oregano = bySku("Oregano").angel!;
  const garlic = bySku("Garlic").angel!;
  const pepper = bySku("Black peppercorn").angel!;
  const powder = bySku("Garlic Powder").angel!;

  it("OREGANO is the informative row: it matches the measurement and NOT the pack string", () => {
    // 6 lb against a `1/5 LB` pack string and a 6.001 lb invoice mean. This is the
    // one reading a pack-string reader could not have produced, and it is the
    // whole reason the scale gate closes.
    expect(classifyReadingAgainstPackString(6, oregano)).toBe("MATCHES_MEASUREMENT");
  });

  it("the other three all match their pack strings, and only their pack strings", () => {
    // Garlic: 5 against a `1/5 LB` string and a 5.996 lb mean (16.6% away).
    expect(classifyReadingAgainstPackString(5, garlic)).toBe("MATCHES_PACK_STRING");
    // 5.75 is NOT a scale tell — McCormick's pack string is literally `1/5.75LB`,
    // and the invoice's 6.119 is 6.0% away, well outside the informative band.
    expect(classifyReadingAgainstPackString(5.75, pepper)).toBe("MATCHES_PACK_STRING");
    expect(pepper.packString).toBe("1/5.75LB");
    // Garlic powder: 6 is the `3/6 LB` inner unit exactly; the invoice's
    // 19.872/3 = 6.624 lb per tub is 9.4% away.
    expect(classifyReadingAgainstPackString(6, powder)).toBe("MATCHES_PACK_STRING");
  });

  it("compares the measurement PER INNER UNIT, never per case", () => {
    // The bug this prevents: comparing Juan's 6 lb tub against a 19.872 lb case
    // and reporting disagreement as though it were evidence.
    expect(powder.unitsPerAngelUnit).toBe(3);
    // 6.624 lb/tub is what the case's 19.872 lb means at the grain he read.
    expect(classifyReadingAgainstPackString(6.624, powder)).toBe("MATCHES_MEASUREMENT");
    expect(classifyReadingAgainstPackString(19.872, powder)).toBe("MATCHES_NEITHER");
  });

  it("answers NO_ANGEL_ROW where Angel carries nothing", () => {
    expect(bySku("Chili Flake").angel).toBeNull();
    expect(classifyReadingAgainstPackString(4, null)).toBe("NO_ANGEL_ROW");
  });

  it("holds the asymmetric tolerances: absolute on the string, relative and TIGHT on the measurement", () => {
    // A pack string is printed: equal or not.
    expect(PACK_STRING_TOLERANCE_LBS).toBeLessThan(0.05);
    expect(classifyReadingAgainstPackString(5.02, garlic)).not.toBe("MATCHES_PACK_STRING");
    // The informative label is not handed out cheaply. 2% of 6.001 is 0.12 lb.
    expect(MEASUREMENT_TOLERANCE_FRACTION).toBeLessThanOrEqual(0.02);
    expect(classifyReadingAgainstPackString(6.1, oregano)).toBe("MATCHES_MEASUREMENT");
    expect(classifyReadingAgainstPackString(6.4, oregano)).toBe("MATCHES_NEITHER");
  });

  it("every agreement value carries a meaning", () => {
    const all: ReadingAgreement[] = [
      "MATCHES_PACK_STRING", "MATCHES_MEASUREMENT", "MATCHES_BOTH", "MATCHES_NEITHER", "NO_ANGEL_ROW",
    ];
    for (const a of all) expect(READING_AGREEMENT_MEANING[a].length).toBeGreaterThan(40);
  });
});

describe("measuredSpreadFraction — did the vendor's number ever move?", () => {
  it("garlic moves and oregano does not — wave 4's own discriminator", () => {
    const garlic = measuredSpreadFraction(bySku("Garlic").angel!);
    const oregano = measuredSpreadFraction(bySku("Oregano").angel!);
    expect(garlic).toBeGreaterThan(0.002);
    expect(oregano).toBe(0);
  });

  it("black pepper is NEAR-constant, which is why its pack string wins", () => {
    // 6.117-6.12 over three lines. Not exactly zero, and far below anything a
    // catch-weight product produces — the signature of a stored number.
    const spread = measuredSpreadFraction(bySku("Black peppercorn").angel!);
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(0.001);
  });
});

describe("disposeTub — the ladder, and its order", () => {
  it("no SKU is a decision-table row, never a write", () => {
    expect(disposeTub({ skuFound: false, readingOz: 96, livePackOz: null, livePackClass: null }))
      .toBe("NO_MATCHING_SKU");
  });

  it("no live pack is a FILL, and no class can block a fill", () => {
    expect(disposeTub({ skuFound: true, readingOz: 96, livePackOz: null, livePackClass: null }))
      .toBe("WRITE_NEW_PACK");
    expect(disposeTub({ skuFound: true, readingOz: 92, livePackOz: null, livePackClass: "OPERATIONAL" }))
      .toBe("WRITE_NEW_PACK");
  });

  it("AGREEMENT OUTRANKS CONFLICT — the order that matters", () => {
    // Chili flake's live 64 oz already equals the reading. If the measured-class
    // check ran first, a future measured class on that pack would report a
    // conflict between two identical numbers.
    expect(disposeTub({ skuFound: true, readingOz: 64, livePackOz: 64, livePackClass: "INVOICE_DERIVED" }))
      .toBe("CONFIRMS_LIVE");
    expect(disposeTub({ skuFound: true, readingOz: 64, livePackOz: 64, livePackClass: null }))
      .toBe("CONFIRMS_LIVE");
  });

  it("a measured live pack refuses; an unmeasured one is written", () => {
    // Garlic: 80 against a live 95.94 that a scale produced.
    expect(disposeTub({ skuFound: true, readingOz: 80, livePackOz: 95.94, livePackClass: "INVOICE_DERIVED" }))
      .toBe("CONFLICT_PRESENT_ONLY");
    expect(disposeTub({ skuFound: true, readingOz: 80, livePackOz: 95.94, livePackClass: "OPERATIONAL" }))
      .toBe("CONFLICT_PRESENT_ONLY");
    // Oregano: 96 against a live 80 written at a pack string's nominal.
    expect(disposeTub({ skuFound: true, readingOz: 96, livePackOz: 80, livePackClass: null }))
      .toBe("WRITE_RESOLUTION");
    expect(disposeTub({ skuFound: true, readingOz: 96, livePackOz: 80, livePackClass: "SPEC" }))
      .toBe("WRITE_RESOLUTION");
    // An unrecognised class does NOT get the benefit of the doubt.
    expect(disposeTub({ skuFound: true, readingOz: 96, livePackOz: 80, livePackClass: "MEASURED-ISH" }))
      .toBe("WRITE_RESOLUTION");
  });

  it("every disposition carries a meaning", () => {
    const all: TubDisposition[] = [
      "WRITE_NEW_PACK", "WRITE_RESOLUTION", "CONFIRMS_LIVE", "CONFLICT_PRESENT_ONLY", "NO_MATCHING_SKU",
    ];
    for (const d of all) expect(DISPOSITION_MEANING[d].length).toBeGreaterThan(30);
  });

  it("dispatches today's five rows exactly as the wave describes them", () => {
    const outcomes = TUB_READINGS.map((t) =>
      disposeTub({
        skuFound: true,
        readingOz: tubPackOz(t.lbs),
        livePackOz: t.expectedLivePackOz,
        livePackClass: t.expectedLivePackClass,
      }),
    );
    expect(outcomes).toEqual([
      "WRITE_NEW_PACK",        // Garlic Powder — no pack at all
      "WRITE_RESOLUTION",      // Oregano — 80 -> 96, the scale gate closing
      "CONFLICT_PRESENT_ONLY", // Garlic — 80 against an INVOICE_DERIVED 95.94
      "CONFIRMS_LIVE",         // Chili Flake — 64 = 64
      "WRITE_NEW_PACK",        // Black peppercorn — no pack at all
    ]);
  });
});

describe("tubPackOz", () => {
  it("converts Juan's pounds to pack ounces without inventing precision", () => {
    expect(tubPackOz(6)).toBe(96);
    expect(tubPackOz(5)).toBe(80);
    expect(tubPackOz(4)).toBe(64);
    expect(tubPackOz(5.75)).toBe(92);
  });
});

describe("packRecostEffect — a content change is NOT a price change", () => {
  it("oregano: the jug still costs $55.27, and only $/oz moves", () => {
    const e = packRecostEffect({ packOzBefore: 80, packOzAfter: 96, unitPriceUsd: 55.27 });
    expect(e.priceRowUnchanged).toBe(true);
    expect(e.unitPriceUsd).toBe(55.27);
    expect(e.costPerOzBefore).toBeCloseTo(0.690875, 6);
    expect(e.costPerOzAfter).toBeCloseTo(0.575729, 6);
    // -16.67%: the pack grew by a fifth, so the ounce got a sixth cheaper.
    expect(e.costPerOzChange).toBeCloseTo(-1 / 6, 6);
  });

  it("garlic, if the conflict ever resolved to 80 oz: $/oz rises 20%", () => {
    const e = packRecostEffect({ packOzBefore: 95.94, packOzAfter: 80, unitPriceUsd: 19.72 });
    expect(e.costPerOzBefore).toBeCloseTo(0.205545, 6);
    expect(e.costPerOzAfter).toBeCloseTo(0.2465, 6);
    expect(e.costPerOzChange).toBeCloseTo(0.19925, 4);
    expect(e.priceRowUnchanged).toBe(true);
  });

  it("an unpriced SKU recosts to nothing, and says so with nulls", () => {
    const e = packRecostEffect({ packOzBefore: null, packOzAfter: 92, unitPriceUsd: null });
    expect(e.costPerOzBefore).toBeNull();
    expect(e.costPerOzAfter).toBeNull();
    expect(e.costPerOzChange).toBeNull();
    expect(e.priceRowUnchanged).toBe(true);
  });

  it("a first pack on a priced SKU has no BEFORE, and does not fabricate one", () => {
    const e = packRecostEffect({ packOzBefore: null, packOzAfter: 92, unitPriceUsd: 53.52 });
    expect(e.costPerOzBefore).toBeNull();
    expect(e.costPerOzAfter).toBeCloseTo(0.581739, 6);
    expect(e.costPerOzChange).toBeNull();
  });
});

describe("the garlic conflict — presented, never written", () => {
  it("carries both numbers, both hypotheses and the test that settles it", () => {
    expect(GARLIC_TARE_CONFLICT.liveOz).toBe(95.94);
    expect(GARLIC_TARE_CONFLICT.readingOz).toBe(80);
    expect(isMeasuredWeightClass(GARLIC_TARE_CONFLICT.liveClass)).toBe(true);
    expect(GARLIC_TARE_CONFLICT.hypothesis).toMatch(/GROSS|brine/i);
    expect(GARLIC_TARE_CONFLICT.counterHypothesis.length).toBeGreaterThan(60);
    expect(GARLIC_TARE_CONFLICT.recommendation).toContain("DO NOT WRITE");
    expect(GARLIC_TARE_CONFLICT.decisiveTest).toMatch(/drain/i);
  });

  it("names the beef-base precedent that points the other way", () => {
    expect(GARLIC_TARE_CONFLICT.precedent).toContain("BEEF_BASE_RULING");
    expect(GARLIC_TARE_CONFLICT.precedent).toContain("1.117");
    expect(GARLIC_TARE_CONFLICT.precedent).toContain("1.199");
  });

  it("the gap is the tare, and the arithmetic is checkable", () => {
    // 95.94 billed - 80 usable = 15.94 oz of water and plastic.
    expect(billedVsNetGapOz(95.94, 80)).toBe(15.94);
    expect(GARLIC_TARE_CONFLICT.gapOz).toBe(15.94);
    expect(billedVsNetGapOz(null, 80)).toBeNull();
    expect(billedVsNetGapOz(95.94, null)).toBeNull();
  });

  it("the price is correct under BOTH readings, so nothing about it moves", () => {
    expect(GARLIC_TARE_CONFLICT.unitPriceUsd).toBe(19.72);
    expect(GARLIC_TARE_CONFLICT.recommendation).toContain("does not move");
  });

  it("names the BILLED_VS_NET class and both of its precedents", () => {
    expect(BILLED_VS_NET_NOTE_CLASS).toContain("BILLED_VS_NET");
    expect(BILLED_VS_NET_NOTE_CLASS).toMatch(/glass/i);
    expect(BILLED_VS_NET_NOTE_CLASS).toMatch(/brine/i);
    expect(BILLED_VS_NET_NOTE_CLASS).toMatch(/USABLE/);
  });
});

describe("onion powder — the half of the gate that stays shut", () => {
  it("is not one of the five readings", () => {
    expect(TUB_READINGS.some((t) => t.skuName === "Onion Powder")).toBe(false);
    expect(JUAN_TUB_READING).not.toContain("onion");
  });

  it("states the inference it is deliberately NOT acting on", () => {
    expect(ONION_POWDER_STILL_GATED.livePackOz).toBe(80);
    expect(ONION_POWDER_STILL_GATED.wouldBeOz).toBe(96);
    expect(ONION_POWDER_STILL_GATED.whyNotInferred).toMatch(/inference is not a measurement/i);
    expect(ONION_POWDER_STILL_GATED.unblock).toMatch(/tub/i);
  });
});

describe("WAVE5_REASONS — a closed refusal vocabulary", () => {
  it("explains every code, in a sentence a reader can act on", () => {
    const all: Wave5Code[] = [
      "SKU_UNRESOLVED", "VENDOR_DRIFT", "PACK_SHAPE_CHANGED", "PACK_CLASS_DRIFT",
      "MEASURED_CONFLICT", "ALREADY_CORRECT", "NOT_IN_READING", "PRICE_NEEDS_APPROVAL",
    ];
    expect(Object.keys(WAVE5_REASONS).sort()).toEqual([...all].sort());
    for (const c of all) expect(WAVE5_REASONS[c].length).toBeGreaterThan(40);
  });
});

describe("type surface", () => {
  it("EvidenceClass is exactly the two answers", () => {
    const spec: EvidenceClass = "SPEC";
    const op: EvidenceClass = "OPERATIONAL";
    expect([spec, op]).toEqual(["SPEC", "OPERATIONAL"]);
  });
});
