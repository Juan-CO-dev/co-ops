/**
 * Unit spine — lib/angel-wave3.ts (the Angel harvest-2 PIECE MODEL).
 *
 * Waves 1 and 2 guard a divisor and a weight-trust classifier. Wave 3's arithmetic
 * decides three things none of those touch, and all three fail SILENTLY:
 *
 *  1. **The slice cross-check's direction and threshold.** `avg_oz_per_each` is what
 *     every `1 unit` portioned recipe line depletes. If the tolerance is loose
 *     enough to swallow a real disagreement, a derived number overwrites Juan's
 *     hand-measured one and the system quietly changes how much meat it thinks left
 *     the building. If it is tight enough to trip on the CSV's own integer-floor
 *     rounding, every row stops and the wave delivers nothing. The tests pin both
 *     edges against the real data, including capicola's +0.88% worst-case artifact.
 *
 *  2. **The bacon strip weight.** One number, 64% of a cost. It is derived two ways
 *     (from the 12/14 spec, and from the 240 oz box ÷ strips) and the test asserts
 *     they meet — because a lone constant nobody can re-derive is how a typo ships.
 *
 *  3. **Cost-per-ounce neutrality of the jug supersede.** The whole safety argument
 *     for changing a pack and a price in one step is that $/oz does not move. That
 *     is a claim about arithmetic, so it is testable, so it is tested — if it ever
 *     stops holding, the correction has become a repricing and needs Juan again.
 *
 * Plus the parsers, which are the usual silent-shear risk: a mis-parsed `180-210`
 * would coerce to NaN and take every bacon number with it.
 */
import { describe, it, expect } from "vitest";
import {
  parsePieceStructure, parsePackRecheck, packRecheckKey,
  crossCheckSlice, parseSliceCount, pieceWeightInRange,
  ozPerStripFromSlicesPerLb, costPerOz, costPerOzUnchanged,
  rulingStatus, sliceEconomics,
  SPEC_SLICE_OZ, OPERATIONAL_SLICE_OZ, JUAN_RULING,
  PIECE_MODEL_RULES, JUG_SUPERSEDES,
  BACON_SLICE_SPEC, BACON_CORRECTION, MOZZARELLA_CASE, DRIED_CHIVES,
  SLICE_CROSSCHECK_TOLERANCE, PERMANENT_SUPPLY_RUN_GAPS, WAVE3_REASONS,
  type Wave3Code,
} from "@/lib/angel-wave3";

// ── The parsers ────────────────────────────────────────────────────────────────

const PIECE_CSV = [
  "product,angel_subtitle,unit_descriptor,pieces_per_invoice_unit,lbs_per_piece,lbs_per_piece_min,lbs_per_piece_max,oz_per_piece,coops_sku,coops_oz_per_slice,slices_per_piece,price_per_lb,cost_per_slice,cost_per_piece",
  "OVENGOLD TURKEY,GROCERY-REF-FZN · TURKEY · TURKEY · 1 CT,1 CT (sold by the piece),1,9.251,9.161,9.297,148.0,Turkey,1.0,148,6.29,0.3931,58.19",
  "IMP LAYER BACON 12/14,GROCERY-REF-FZN · BACON · LAYER BACON · 12/14 · 1 CT,1 CT (sold by the 15 lb box),180-210 strips,15.0,15.0,15.0,240.0,Bacon,0.75,180-210,4.69,0.3350-0.3908,70.35",
].join("\n");

describe("parsePieceStructure", () => {
  it("parses numeric columns and keeps the range columns RAW", () => {
    const rows = parsePieceStructure(PIECE_CSV);
    expect(rows).toHaveLength(2);
    const turkey = rows[0]!;
    expect(turkey.product).toBe("OVENGOLD TURKEY");
    expect(turkey.ozPerPiece).toBe(148);
    expect(turkey.lbsPerPiece).toBeCloseTo(9.251, 6);
    expect(turkey.slicesPerPieceRaw).toBe("148");
    expect(turkey.pricePerLb).toBe(6.29);

    // The bacon row is the reason `slices_per_piece` is a string on the interface:
    // coercing "180-210" to Number gives NaN and takes every derived value with it.
    const bacon = rows[1]!;
    expect(bacon.slicesPerPieceRaw).toBe("180-210");
    expect(Number.isNaN(Number(bacon.slicesPerPieceRaw))).toBe(true);
    expect(bacon.ozPerPiece).toBe(240);
  });

  it("is header-driven, not position-driven", () => {
    const reordered = [
      "oz_per_piece,product,angel_subtitle,unit_descriptor,pieces_per_invoice_unit,lbs_per_piece,lbs_per_piece_min,lbs_per_piece_max,coops_sku,coops_oz_per_slice,slices_per_piece,price_per_lb,cost_per_slice,cost_per_piece",
      "88.0,MILD PROVOLONE,x,y,1,5.502,5.5,5.517,Provolone,0.75,117,3.49,0.1636,19.2",
    ].join("\n");
    const row = parsePieceStructure(reordered)[0]!;
    expect(row.product).toBe("MILD PROVOLONE");
    expect(row.ozPerPiece).toBe(88);
  });

  it("throws on a missing column rather than silently returning nulls", () => {
    expect(() => parsePieceStructure("product,oz_per_piece\nX,1")).toThrow(/expected column/);
  });
});

describe("parsePackRecheck", () => {
  const CSV = [
    "product,brand,vendor,pack_size_field,angel_pack_descriptor,units_per_case,nominal_lbs,angel_net_lbs_per_case,net_over_nominal,case_price,angel_price_per_lb,price_per_lb_if_nominal,structure",
    "OREGANO LEAVES,ROMA,PFG,1/5 LB,5 LB,1,5.0,6.0,1.2,55.27,9.21,11.05,single 5 lb jug",
    '"Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning",Monarch,US Foods,6/1.12 OZ,0.5 LB,6,0.42,0.07,0.167,9.72,138.86,23.14,6 x 1.12 oz shakers',
  ].join("\n");

  it("answers the oregano question: units_per_case is 1", () => {
    const rows = parsePackRecheck(CSV);
    expect(rows[0]!.unitsPerCase).toBe(1);
    expect(rows[0]!.casePrice).toBe(55.27);
    expect(rows[0]!.netOverNominal).toBe(1.2);
  });

  it("survives a quoted, comma-laden product name (the US Foods dialect)", () => {
    const rows = parsePackRecheck(CSV);
    expect(rows[1]!.product).toBe("Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning");
    expect(rows[1]!.unitsPerCase).toBe(6);
  });

  it("keys on product+brand+vendor+pack, because product alone is not unique", () => {
    // The real CSV carries OREGANO LEAVES twice under ONE brand at two sizes.
    const a = packRecheckKey({ product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeField: "1/5 LB" });
    const b = packRecheckKey({ product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeField: "1/24 OZ" });
    expect(a).not.toBe(b);
  });
});

describe("parseSliceCount", () => {
  it("parses a bare integer and a range", () => {
    expect(parseSliceCount("148")).toEqual({ lo: 148, hi: 148 });
    expect(parseSliceCount("180-210")).toEqual({ lo: 180, hi: 210 });
    expect(parseSliceCount(" 180 – 210 ")).toEqual({ lo: 180, hi: 210 }); // en dash
  });

  it("refuses anything it does not fully recognise", () => {
    // A mis-parse here silently halves or doubles every per-slice weight downstream,
    // so "close enough" is not an option.
    expect(parseSliceCount("180-210 strips")).toBeNull();
    expect(parseSliceCount("~148")).toBeNull();
    expect(parseSliceCount("210-180")).toBeNull(); // inverted range
    expect(parseSliceCount("0")).toBeNull();
    expect(parseSliceCount("")).toBeNull();
  });
});

// ── The slice cross-check ──────────────────────────────────────────────────────

describe("crossCheckSlice", () => {
  it("reproduces the SPEC table from the piece model for every SKU that has both", () => {
    // The real numbers, straight off docs/angel-piece-structure.csv. This is the
    // check the whole of section A hangs on: if the piece reframe had shifted a
    // decimal anywhere, at least one of these would miss.
    const cases: Array<[string, number, number]> = [
      ["Turkey", 148.0, 148],
      ["Roast Beef", 110.9, 74],
      ["Provolone", 88.0, 117],
      ["Genoa", 103.0, 103],
      ["Capicola", 57.5, 57],
      ["Pepperoni", 55.9, 224],
    ];
    for (const [sku, pieceOz, slices] of cases) {
      const check = crossCheckSlice(pieceOz, slices, SPEC_SLICE_OZ[sku]!);
      expect(check.verdict, `${sku} should agree with Juan's table`).toBe("AGREES");
    }
  });

  it("leaves headroom over the CSV's worst integer-floor artifact (capicola, +0.88%)", () => {
    // slices_per_piece is floor(piece_oz / juan_oz), so the derived value is biased
    // HIGH by at most 1/slices. Capicola at 57 slices is the widest in this dataset.
    // If the tolerance is ever tightened below this, section A stops on a rounding
    // artifact and delivers nothing.
    const capicola = crossCheckSlice(57.5, 57, 1.0);
    expect(capicola.deltaFraction!).toBeGreaterThan(0);
    expect(capicola.deltaFraction!).toBeLessThan(0.01);
    expect(SLICE_CROSSCHECK_TOLERANCE).toBeGreaterThan(capicola.deltaFraction! * 2);
  });

  it("MEASURES the spec-to-operational gap — the quantity Juan's ruling made meaningful", () => {
    // These are the values production actually carries, checked against the piece
    // model. Pre-ruling these were the STOP list; post-ruling they are the measured
    // gap between what a slice should weigh and what it does. Either way the detector
    // must fire, or the five ruled SKUs get silently overwritten with spec numbers.
    expect(crossCheckSlice(103.0, 103, 0.4).verdict).toBe("DISAGREES"); // Genoa, live 0.4
    expect(crossCheckSlice(57.5, 57, 0.4).verdict).toBe("DISAGREES"); // Capicola, live 0.4
    expect(crossCheckSlice(88.0, 117, 0.7).verdict).toBe("DISAGREES"); // Provolone, live 0.7
    expect(crossCheckSlice(55.9, 224, 0.2).verdict).toBe("DISAGREES"); // Pepperoni, live 0.2
    // ...and must NOT fire on the two that production has right.
    expect(crossCheckSlice(148.0, 148, 1.0).verdict).toBe("AGREES"); // Turkey, live 1.0
    expect(crossCheckSlice(110.9, 74, 1.5).verdict).toBe("AGREES"); // Roast Beef, live 1.5
  });

  it("distinguishes 'no reference' from 'disagrees'", () => {
    // Ever Roast Chicken has no entry in Juan's table and NULL live. That is a fill
    // opportunity, not a contest — collapsing the two would either block a legitimate
    // write or launder a missing value into an agreement.
    const c = crossCheckSlice(74.1, 74, null);
    expect(c.verdict).toBe("NO_REFERENCE");
    expect(c.derivedOzPerSlice).toBeCloseTo(1.0014, 4);
    expect(c.deltaFraction).toBeNull();
  });

  it("returns UNCOMPUTABLE rather than a wrong number on bad inputs", () => {
    expect(crossCheckSlice(null, 148, 1.0).verdict).toBe("UNCOMPUTABLE");
    expect(crossCheckSlice(148, 0, 1.0).verdict).toBe("UNCOMPUTABLE");
    expect(crossCheckSlice(148, null, 1.0).verdict).toBe("UNCOMPUTABLE");
    expect(crossCheckSlice(-1, 148, 1.0).verdict).toBe("UNCOMPUTABLE");
  });

  it("is symmetric about the tolerance in both directions", () => {
    expect(crossCheckSlice(100, 100, 1.05).verdict).toBe("AGREES"); // −4.8%
    expect(crossCheckSlice(100, 100, 1.06).verdict).toBe("DISAGREES"); // −5.7%
    expect(crossCheckSlice(100, 100, 0.96).verdict).toBe("AGREES"); // +4.2%
    expect(crossCheckSlice(100, 100, 0.94).verdict).toBe("DISAGREES"); // +6.4%
  });
});

// ── Juan's ruling ──────────────────────────────────────────────────────────────

describe("the operational-weight ruling (Juan 2026-08-20)", () => {
  it("covers exactly the five SKUs that diverged from seed 10, and no others", () => {
    // The divergence IS the evidence a measurement happened. Turkey, Roast Beef and
    // Bacon never moved off the spec table, so there is nothing recorded for them —
    // and adding one would be ratifying an estimate by association.
    expect(Object.keys(OPERATIONAL_SLICE_OZ).sort()).toEqual(
      ["Capicola", "Genoa", "Ham", "Pepperoni", "Provolone"],
    );
    for (const unmeasured of ["Turkey", "Roast Beef", "Bacon"]) {
      expect(OPERATIONAL_SLICE_OZ[unmeasured]).toBeUndefined();
    }
  });

  it("records a real gap on every ruled SKU — a no-op entry would be noise", () => {
    for (const [sku, operational] of Object.entries(OPERATIONAL_SLICE_OZ)) {
      const spec = SPEC_SLICE_OZ[sku];
      expect(spec, `${sku} must have a spec value to have superseded`).toBeDefined();
      expect(operational, `${sku} operational must differ from spec`).not.toBe(spec);
    }
  });

  it("has four SKUs lighter than spec and ham heavier — the shape of the finding", () => {
    // Direction matters: a line slicing to a visual target rather than a scale tends
    // to run thin. If this ever flips wholesale, something other than slicing changed.
    const lighter = Object.entries(OPERATIONAL_SLICE_OZ).filter(([s, op]) => op < SPEC_SLICE_OZ[s]!);
    const heavier = Object.entries(OPERATIONAL_SLICE_OZ).filter(([s, op]) => op > SPEC_SLICE_OZ[s]!);
    expect(lighter.map(([s]) => s).sort()).toEqual(["Capicola", "Genoa", "Pepperoni", "Provolone"]);
    expect(heavier.map(([s]) => s)).toEqual(["Ham"]);
  });

  it("states the ruling in a form that survives into an audit row", () => {
    expect(JUAN_RULING).toMatch(/surprise/i);
    expect(JUAN_RULING).toMatch(/operational/i);
    expect(JUAN_RULING).toMatch(/2026-08-20/);
  });
});

describe("rulingStatus", () => {
  it("KEEPS LIVE when production still carries the ruled weight", () => {
    expect(rulingStatus("Genoa", 0.4)).toBe("RULED_KEEP_LIVE");
    expect(rulingStatus("Ham", 1.2)).toBe("RULED_KEEP_LIVE");
    expect(rulingStatus("Pepperoni", 0.2)).toBe("RULED_KEEP_LIVE");
  });

  it("flags DRIFT when a ruled row moves AGAIN — including back to spec", () => {
    // The failure mode this exists to catch: someone "fixes" genoa back to the spec
    // 1.0 from a cut sheet. That must surface as a new divergence, not be accepted.
    expect(rulingStatus("Genoa", 1.0)).toBe("RULED_DRIFTED");
    expect(rulingStatus("Ham", 1.0)).toBe("RULED_DRIFTED");
    expect(rulingStatus("Genoa", null)).toBe("RULED_DRIFTED");
  });

  it("reports UNRULED where no measurement exists, so spec logic still applies", () => {
    expect(rulingStatus("Turkey", 1.0)).toBe("UNRULED");
    expect(rulingStatus("Ever Roast Chicken", null)).toBe("UNRULED");
    expect(rulingStatus("Bacon", 0.75)).toBe("UNRULED");
  });
});

describe("sliceEconomics", () => {
  it("recomputes the harvest's per-slice numbers at the operational weight", () => {
    // Genoa is the headline correction: the harvest doc says 103 slices at $0.2744,
    // both computed off the spec weight. On the line it is 257 at ~$0.11 — a 2.5x
    // error in per-slice cost, in the direction that overstates food cost.
    const spec = sliceEconomics(103.0, SPEC_SLICE_OZ.Genoa!, 28.26);
    const operational = sliceEconomics(103.0, OPERATIONAL_SLICE_OZ.Genoa!, 28.26);
    expect(spec.slicesPerPiece).toBe(103);
    expect(spec.costPerSlice).toBeCloseTo(0.2744, 3);
    expect(operational.slicesPerPiece).toBe(257);
    expect(operational.costPerSlice).toBeCloseTo(0.11, 2);
    expect(spec.costPerSlice! / operational.costPerSlice!).toBeCloseTo(2.5, 1);
  });

  it("floors the slice count — a partial slice is not a slice", () => {
    expect(sliceEconomics(57.5, 0.4, 19.59).slicesPerPiece).toBe(143); // 143.75 floored
  });

  it("returns nulls rather than Infinity/NaN on bad input", () => {
    expect(sliceEconomics(null, 1, 10).slicesPerPiece).toBeNull();
    expect(sliceEconomics(100, 0, 10).slicesPerPiece).toBeNull();
    expect(sliceEconomics(100, 200, 10).slicesPerPiece).toBeNull(); // slice heavier than the piece
    expect(sliceEconomics(100, 1, null).costPerSlice).toBeNull();
    expect(sliceEconomics(100, 1, 0).costPerSlice).toBeNull();
  });
});

describe("pieceWeightInRange", () => {
  it("confirms harvest 2's piece weight against harvest 1's algebraic range", () => {
    expect(pieceWeightInRange(9.251, 9.1589, 9.2976)).toBe(true); // turkey
    expect(pieceWeightInRange(6.93, 6.5512, 7.1865)).toBe(true); // london broil
    expect(pieceWeightInRange(15.0, 15.0, 15.0)).toBe(true); // bacon, fixed box
  });

  it("rejects a weight the invoices never saw", () => {
    expect(pieceWeightInRange(4.61, 9.1589, 9.2976)).toBe(false); // the wave-2 'Case of 2' guess
    expect(pieceWeightInRange(null, 1, 2)).toBe(false);
    expect(pieceWeightInRange(1.5, null, 2)).toBe(false);
  });

  it("allows exactly the declared slack and no more", () => {
    expect(pieceWeightInRange(10.09, 10, 10, 0.01)).toBe(true);
    expect(pieceWeightInRange(10.2, 10, 10, 0.01)).toBe(false);
    expect(pieceWeightInRange(9.91, 10, 10, 0.01)).toBe(true);
    expect(pieceWeightInRange(9.8, 10, 10, 0.01)).toBe(false);
  });
});

// ── The bacon correction ───────────────────────────────────────────────────────

describe("ozPerStripFromSlicesPerLb", () => {
  it("derives 1.23 oz/strip from the 12/14 spec", () => {
    expect(ozPerStripFromSlicesPerLb(12, 14)).toBe(1.23);
    expect(BACON_CORRECTION.toOz).toBe(1.23);
  });

  it("agrees with the SECOND, independent derivation from the 240 oz box", () => {
    // 240 oz ÷ 1.23 = 195.1 strips, which must land inside the 180–210 the spec
    // implies. Two routes to one number: if either constant is ever typo'd, this
    // fails instead of shipping a plausible-looking wrong cost.
    const strips = BACON_CORRECTION.boxOz / BACON_CORRECTION.toOz;
    expect(strips).toBeGreaterThan(BACON_CORRECTION.boxOz / (16 / BACON_SLICE_SPEC.slicesPerLbLo));
    expect(strips).toBeLessThan(BACON_CORRECTION.boxOz / (16 / BACON_SLICE_SPEC.slicesPerLbHi) + 1);
    expect(strips).toBeGreaterThanOrEqual(180);
    expect(strips).toBeLessThanOrEqual(210);
  });

  it("quantifies the understatement the correction removes", () => {
    // The headline: co-ops is 64% low on bacon. Asserted so the report's number and
    // the code's number can never drift apart.
    const understatement = BACON_CORRECTION.toOz / BACON_CORRECTION.fromOz - 1;
    expect(understatement).toBeCloseTo(0.64, 2);
  });

  it("throws rather than emitting a nonsense weight", () => {
    expect(() => ozPerStripFromSlicesPerLb(0, 14)).toThrow();
    expect(() => ozPerStripFromSlicesPerLb(14, 12)).toThrow();
    expect(() => ozPerStripFromSlicesPerLb(Number.NaN, 14)).toThrow();
  });
});

describe("MOZZARELLA_CASE", () => {
  it("closes 6 logs x 32 slices x 1 oz = 192 slices = 192 oz = 12 lb", () => {
    expect(MOZZARELLA_CASE.slicesPerCase).toBe(192);
    expect(MOZZARELLA_CASE.caseOz).toBe(192);
    expect(MOZZARELLA_CASE.caseOz / 16).toBe(12);
  });

  it("shows why the live 72 cannot be right", () => {
    // 72 units implies a 4.5 lb case — neither the 12 lb nominal on the subtitle nor
    // the 12.76 lb Angel measured. It is not a near-miss; it is a different product.
    expect(MOZZARELLA_CASE.fromUnits / 16).toBe(4.5);
    expect(MOZZARELLA_CASE.caseOz / MOZZARELLA_CASE.fromUnits).toBeCloseTo(2.667, 3);
  });

  it("prices a slice at the harvest's $0.2453", () => {
    expect(47.1 / MOZZARELLA_CASE.slicesPerCase).toBeCloseTo(0.2453, 4);
  });
});

// ── The jug supersede ──────────────────────────────────────────────────────────

describe("JUG_SUPERSEDES", () => {
  it("is COST-PER-OUNCE NEUTRAL — the whole safety argument, as arithmetic", () => {
    // If this ever stops holding, the correction has silently become a repricing and
    // needs Juan's eye again rather than a re-run.
    for (const j of JUG_SUPERSEDES) {
      const before = costPerOz(j.wave1UnitPrice, j.currentPackOz);
      const after = costPerOz(j.casePriceUsd, j.nominalJugOz);
      expect(costPerOzUnchanged(before, after), `${j.skuName} $/oz must not move`).toBe(true);
    }
  });

  it("takes the jug price from Angel's CASE price, never from the rounded wave-1 price", () => {
    // Oregano is the live counter-example: $13.82 x 4 = $55.28, but Angel's case is
    // $55.27. Reconstructing through a value already rounded to cents invents a cent
    // — on a correction whose entire claim is that it invents nothing.
    const oregano = JUG_SUPERSEDES.find((j) => j.skuName === "Oregano")!;
    expect(oregano.casePriceUsd).toBe(55.27);
    expect(oregano.wave1UnitPrice * oregano.wave1Divisor).toBeCloseTo(55.28, 2);
    expect(oregano.casePriceUsd).not.toBe(oregano.wave1UnitPrice * oregano.wave1Divisor);
    // Onion powder happens to round-trip cleanly — which is precisely why the rule
    // has to be structural rather than "check whether it matters this time".
    const onion = JUG_SUPERSEDES.find((j) => j.skuName === "Onion Powder")!;
    expect(onion.wave1UnitPrice * onion.wave1Divisor).toBeCloseTo(onion.casePriceUsd, 6);
  });

  it("keeps the divisor and the pack consistent: currentPackOz x divisor = the jug", () => {
    // The jug's nominal ounces are not a new estimate — they are wave 1's own
    // `angelCaseOz`, recovered from its own division table. Anything else would be
    // smuggling a weight change in under a price correction.
    for (const j of JUG_SUPERSEDES) {
      expect(j.currentPackOz * j.wave1Divisor).toBe(j.nominalJugOz);
    }
  });

  it("carries the open 1.20x question WITHOUT applying it", () => {
    for (const j of JUG_SUPERSEDES) {
      expect(j.angelMeasuredJugOz / j.nominalJugOz).toBeCloseTo(1.2, 6);
      expect(j.nominalJugOz).not.toBe(j.angelMeasuredJugOz);
    }
  });

  it("quantifies what the scale check would change, so the deferral is legible", () => {
    const oregano = JUG_SUPERSEDES.find((j) => j.skuName === "Oregano")!;
    const atNominal = costPerOz(oregano.casePriceUsd, oregano.nominalJugOz)!;
    const atMeasured = costPerOz(oregano.casePriceUsd, oregano.angelMeasuredJugOz)!;
    expect(atNominal).toBeCloseTo(0.6909, 4);
    expect(atMeasured).toBeCloseTo(0.5757, 4);
    expect(1 - atMeasured / atNominal).toBeCloseTo(0.1667, 3); // the 20%-of-the-other-direction gap
  });
});

describe("costPerOz / costPerOzUnchanged", () => {
  it("is null-safe rather than NaN-producing", () => {
    expect(costPerOz(null, 16)).toBeNull();
    expect(costPerOz(10, null)).toBeNull();
    expect(costPerOz(10, 0)).toBeNull();
    expect(costPerOz(10, -1)).toBeNull();
  });

  it("treats a missing side as NOT-unchanged (never a silent pass)", () => {
    expect(costPerOzUnchanged(null, 1)).toBe(false);
    expect(costPerOzUnchanged(1, null)).toBe(false);
    expect(costPerOzUnchanged(0, 0)).toBe(false);
  });

  it("holds the tolerance tight — this is arithmetic, not measurement", () => {
    expect(costPerOzUnchanged(1.0, 1.0005)).toBe(true);
    expect(costPerOzUnchanged(1.0, 1.002)).toBe(false);
  });
});

// ── The tables themselves ──────────────────────────────────────────────────────

describe("wave-3 rule tables", () => {
  it("covers exactly the seven SKUs wave 2 refused, and excludes bacon", () => {
    expect(PIECE_MODEL_RULES).toHaveLength(7);
    const names = PIECE_MODEL_RULES.map((r) => r.skuName);
    expect(names).toEqual(["Turkey", "Roast Beef", "Provolone", "Genoa", "Capicola", "Ever Roast Chicken", "Pepperoni"]);
    // Bacon's pack was already right and wave 2 already priced it; rewriting it here
    // would supersede a correct chain for no reason.
    expect(names).not.toContain("Bacon");
  });

  it("never uses a chain label that would shadow a measure unit", () => {
    // The L1 collision law (seed 13): a chain label equal to an active measure_units
    // label is silently preferred by the chain-first walk, turning a measure into a
    // container. `piece` and `jug` are deliberately not measures.
    const measureLabels = new Set([
      "oz", "lb", "gram", "kg", "each", "unit", "count", "can", "clove", "handful",
      "leaf", "sprig", "cup", "quart", "Tbsp", "tsp", "#10 can", "fl oz", "gallon", "liter", "mL",
    ]);
    for (const r of PIECE_MODEL_RULES) expect(measureLabels.has(r.chainLabel)).toBe(false);
    for (const j of JUG_SUPERSEDES) expect(measureLabels.has(j.chainLabel)).toBe(false);
  });

  it("records the six permanent supply-run gaps", () => {
    expect(PERMANENT_SUPPLY_RUN_GAPS).toHaveLength(6);
    expect(PERMANENT_SUPPLY_RUN_GAPS.map((g) => g.skuName)).toContain("Utz Ripples");
  });

  it("undoes the chive shaker's dropped x6 to the harvest's $23.14/lb", () => {
    expect(DRIED_CHIVES.caseOz).toBeCloseTo(6.72, 6);
    expect(DRIED_CHIVES.truePricePerLb).toBeCloseTo(23.14, 2);
    // Angel's printed figure is exactly 6x the truth — the signature of the bug.
    expect(DRIED_CHIVES.angelStatedPricePerLb / DRIED_CHIVES.truePricePerLb).toBeCloseTo(6, 2);
  });

  it("gives every refusal code a reason string", () => {
    const codes: Wave3Code[] = [
      "SKU_UNRESOLVED", "VENDOR_DRIFT", "NO_MEASURED_WEIGHT", "PIECE_WEIGHT_OUT_OF_RANGE",
      "SLICE_TABLE_DISAGREEMENT", "OPERATIONAL_KEEP_LIVE", "OPERATIONAL_DRIFT",
      "LIVE_WEIGHT_UNEXPLAINED", "PACK_SHAPE_CHANGED",
      "OUR_PACK_UNRESOLVABLE", "ALREADY_CORRECT",
    ];
    for (const c of codes) expect(WAVE3_REASONS[c]?.length ?? 0).toBeGreaterThan(30);
  });
});
