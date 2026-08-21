/**
 * The weight & trim audit's PURE core (spec 2026-08-20, "Weight & trim audit").
 *
 * Juan's ruling is the whole design constraint: "triggered on demand. Behaves just
 * like the regular audit to establish ground truth as needed." NO clocks, NO due
 * dates, NO gates. So nothing here reads a wall clock — `now` is always an argument,
 * and every function is total and deterministic. The ranking SUGGESTS; it never
 * computes a deadline, because a deadline is the nag the ruling forbids.
 */
import { describe, it, expect } from "vitest";
import {
  observedTrimFromProduction,
  classifyWeightDrift,
  rankWeightSuggestions,
  type WeightBelief,
} from "@/lib/weights-shared";

const NOW = "2026-08-20T00:00:00Z";

const belief = (over: Partial<WeightBelief> & { subjectId: string; name: string }): WeightBelief => ({
  subjectKind: "sku",
  valueOz: 1,
  unit: "each",
  weightClass: null,
  establishedAt: null,
  establishedBy: null,
  sourceNote: null,
  costPerOz: null,
  usageOz: null,
  blocksRepoint: false,
  ...over,
});

const daysAgo = (n: number): string =>
  new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

describe("observedTrimFromProduction", () => {
  it("is 1 − (output mass ÷ input mass)", () => {
    // 10 pans × 32 oz declared out of 640 oz of SKU in = half the mass never
    // reached the pan. That is a 50% trim, and the direction matters: input
    // EXCEEDS output, never the other way round.
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: 32, inputOz: 640 })).toBe(0.5);
  });

  it("is 0 when every ounce in reaches the pan", () => {
    expect(observedTrimFromProduction({ outputQty: 4, ozPerParUnit: 25, inputOz: 100 })).toBe(0);
  });

  it("is NULL when the prep has never been weighed (ozPerParUnit null)", () => {
    // Six live preps carry no oz_per_par_unit. An unweighed prep cannot testify
    // about its own trim, and a 0 here would be a fabricated observation.
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: null, inputOz: 640 })).toBeNull();
  });

  it("is NULL when nothing went in — never a division by zero, never Infinity", () => {
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: 32, inputOz: 0 })).toBeNull();
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: 32, inputOz: -5 })).toBeNull();
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: 32, inputOz: null })).toBeNull();
  });

  it("is NULL when the output quantity is unknown", () => {
    expect(observedTrimFromProduction({ outputQty: null, ozPerParUnit: 32, inputOz: 640 })).toBeNull();
  });

  it("returns NEGATIVE trim AS-IS — a pan cannot weigh more than its inputs, so surface it", () => {
    // 10 × 32 = 320 oz declared out of 200 oz in. That is impossible, and it is
    // exactly the one-sided reasoning behind MASS_BALANCE_TOLERANCE: clamping to 0
    // would hide a data bug the board exists to expose.
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: 32, inputOz: 200 })).toBeCloseTo(-0.6, 10);
  });

  it("is total on non-finite input rather than propagating NaN", () => {
    expect(observedTrimFromProduction({ outputQty: Number.NaN, ozPerParUnit: 32, inputOz: 640 })).toBeNull();
    expect(observedTrimFromProduction({ outputQty: 10, ozPerParUnit: Number.POSITIVE_INFINITY, inputOz: 640 })).toBeNull();
  });
});

describe("classifyWeightDrift", () => {
  it("no_reference when there is no standard to compare against", () => {
    expect(classifyWeightDrift({ standardTrim: null, observedTrim: 0.3, tolerance: 0.02 })).toBe("no_reference");
  });

  it("no_reference when nothing has been observed yet — the day-one state", () => {
    // Production capture has produced ZERO rows live. Every trim row on the board
    // reads "observed: — (starts with production capture)" and this is why.
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: null, tolerance: 0.02 })).toBe("no_reference");
  });

  it("agrees inside the tolerance band, on both sides and exactly at the edge", () => {
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: 0.38, tolerance: 0.02 })).toBe("agrees");
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: 0.4, tolerance: 0.02 })).toBe("agrees");
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: 0.36, tolerance: 0.02 })).toBe("agrees");
  });

  it("over_trim when MORE is being lost than the standard expects", () => {
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: 0.5, tolerance: 0.02 })).toBe("over_trim");
  });

  it("under_trim when LESS is being lost than the standard expects", () => {
    expect(classifyWeightDrift({ standardTrim: 0.38, observedTrim: 0.2, tolerance: 0.02 })).toBe("under_trim");
  });

  it("a zero standard (vendor-prepped) still classifies — 0 is a value, not an absence", () => {
    // VENDOR_PREPPED_NONE's trim is 0 and that zero is a STATEMENT. Treating it as
    // missing would silently drop the one class that can prove shrink where none
    // should exist.
    expect(classifyWeightDrift({ standardTrim: 0, observedTrim: 0.15, tolerance: 0.02 })).toBe("over_trim");
    expect(classifyWeightDrift({ standardTrim: 0, observedTrim: 0.01, tolerance: 0.02 })).toBe("agrees");
  });

  it("a NEGATIVE observation is over_trim's opposite and still classifies, never throws", () => {
    expect(classifyWeightDrift({ standardTrim: 0.02, observedTrim: -0.6, tolerance: 0.02 })).toBe("under_trim");
  });
});

describe("rankWeightSuggestions", () => {
  it("ranks a re-point BLOCKER first — that is the configuration Phase 4 cannot pass", () => {
    // A multi-member product with unit_oz NULL whose members disagree about what
    // one unit weighs: a member flip silently re-denominates every count-based
    // line. seed 18 refused its own pin-move over exactly this.
    const ranked = rankWeightSuggestions(
      [
        belief({ subjectId: "cheap", name: "Oregano", costPerOz: 0.5, usageOz: 4000, establishedAt: daysAgo(400) }),
        belief({
          subjectKind: "product",
          subjectId: "HAM",
          name: "HAM",
          valueOz: null,
          blocksRepoint: true,
          costPerOz: 0.01,
          usageOz: 1,
        }),
      ],
      { now: NOW },
    );
    expect(ranked[0]?.belief.subjectId).toBe("HAM");
    expect(ranked[0]?.band).toBe("blocks_repoint");
  });

  it("orders priced beliefs by cost impact x staleness, biggest first", () => {
    const ranked = rankWeightSuggestions(
      [
        // $2/oz x 100 oz = $200 of flow, weighed 10 days ago -> 200 x 11
        belief({ subjectId: "b", name: "Bacon", costPerOz: 2, usageOz: 100, establishedAt: daysAgo(10) }),
        // $1/oz x 100 oz = $100 of flow, weighed 100 days ago -> 100 x 101
        belief({ subjectId: "a", name: "Basil", costPerOz: 1, usageOz: 100, establishedAt: daysAgo(100) }),
      ],
      { now: NOW },
    );
    expect(ranked.map((r) => r.belief.subjectId)).toEqual(["a", "b"]);
    expect(ranked[0]?.band).toBe("aging");
    expect(ranked[0]?.costImpact).toBe(100);
    expect(ranked[0]?.stalenessDays).toBe(100);
  });

  it("a NEVER-measured priced weight outranks every aged one — no finite age is staler than never", () => {
    const ranked = rankWeightSuggestions(
      [
        belief({ subjectId: "aged", name: "Aged", costPerOz: 10, usageOz: 10_000, establishedAt: daysAgo(900) }),
        belief({ subjectId: "never", name: "Never", costPerOz: 0.1, usageOz: 10, establishedAt: null }),
      ],
      { now: NOW },
    );
    expect(ranked.map((r) => r.belief.subjectId)).toEqual(["never", "aged"]);
    expect(ranked[0]?.band).toBe("never_measured");
    expect(ranked[0]?.stalenessDays).toBeNull();
  });

  it("a belief with NO cost basis ranks BELOW every priced one, and is never dropped", () => {
    const ranked = rankWeightSuggestions(
      [
        belief({ subjectId: "unrankable", name: "Aioli", costPerOz: null, usageOz: null, establishedAt: null }),
        belief({ subjectId: "priced", name: "Zucchini", costPerOz: 0.01, usageOz: 1, establishedAt: daysAgo(1) }),
      ],
      { now: NOW },
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.belief.subjectId)).toEqual(["priced", "unrankable"]);
    expect(ranked[1]?.band).toBe("unrankable");
    expect(ranked[1]?.score).toBeNull();
  });

  it("half a cost basis is no cost basis — a price with no usage cannot be ranked", () => {
    const ranked = rankWeightSuggestions(
      [belief({ subjectId: "x", name: "X", costPerOz: 9, usageOz: null, establishedAt: daysAgo(5) })],
      { now: NOW },
    );
    expect(ranked[0]?.band).toBe("unrankable");
    expect(ranked[0]?.costImpact).toBeNull();
  });

  it("the ordering is TOTAL — ties break on name then id, never on input row order", () => {
    const mk = (id: string, name: string) =>
      belief({ subjectId: id, name, costPerOz: 1, usageOz: 100, establishedAt: daysAgo(10) });
    const forward = rankWeightSuggestions([mk("z", "Same"), mk("a", "Same"), mk("m", "Other")], { now: NOW });
    const reverse = rankWeightSuggestions([mk("m", "Other"), mk("a", "Same"), mk("z", "Same")], { now: NOW });
    expect(forward.map((r) => r.belief.subjectId)).toEqual(reverse.map((r) => r.belief.subjectId));
    expect(forward.map((r) => r.belief.subjectId)).toEqual(["m", "a", "z"]);
  });

  it("an unparseable establishedAt is treated as NEVER measured, never as now", () => {
    const ranked = rankWeightSuggestions(
      [belief({ subjectId: "bad", name: "Bad", costPerOz: 1, usageOz: 1, establishedAt: "not-a-date" })],
      { now: NOW },
    );
    expect(ranked[0]?.band).toBe("never_measured");
    expect(ranked[0]?.stalenessDays).toBeNull();
  });

  it("a weight established in the FUTURE floors at zero days rather than crediting negative staleness", () => {
    const ranked = rankWeightSuggestions(
      [belief({ subjectId: "f", name: "Future", costPerOz: 1, usageOz: 100, establishedAt: daysAgo(-30) })],
      { now: NOW },
    );
    expect(ranked[0]?.stalenessDays).toBe(0);
    expect(ranked[0]?.score).toBe(100);
  });

  it("returns every input — a suggestion list that silently drops rows is a lie about coverage", () => {
    const input = [
      belief({ subjectId: "1", name: "A" }),
      belief({ subjectId: "2", name: "B", blocksRepoint: true }),
      belief({ subjectId: "3", name: "C", costPerOz: 1, usageOz: 1, establishedAt: daysAgo(3) }),
    ];
    expect(rankWeightSuggestions(input, { now: NOW })).toHaveLength(3);
  });

  it("does not mutate the caller's array", () => {
    const input = [belief({ subjectId: "b", name: "B" }), belief({ subjectId: "a", name: "A" })];
    rankWeightSuggestions(input, { now: NOW });
    expect(input.map((b) => b.subjectId)).toEqual(["b", "a"]);
  });
});
