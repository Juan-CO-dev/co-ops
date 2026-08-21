/**
 * Unit spine — lib/angel-wave4.ts (the Angel wave-4 refusal resolutions).
 *
 * Waves 1-3 guard a divisor, a weight-trust classifier and a slice cross-check.
 * Wave 4's arithmetic decides three things none of those touch, and all three fail
 * SILENTLY:
 *
 *  1. **What "average" means.** `invoiceAverageLbs` is the function Juan's herb
 *     policy names, and it becomes a pack CONTENT — the denominator under every
 *     cost-per-ounce a menu item derives. Two readings of "average" exist and they
 *     are different computations; today they agree to 0.01%, which is exactly the
 *     condition under which a silent switch between them would never be noticed.
 *     So both are computed and both are pinned.
 *
 *  2. **The fabricated-weight exclusion.** `BASIL FRSH` [FRSH ADV] carries seven
 *     invoice lines whose net weight is exactly 1.0 x quantity — Angel's
 *     fabrication — beside a genuinely-measured sibling with an IDENTICAL `1/1 LB`
 *     pack string. Averaging them together produces a plausible number that is
 *     wrong, from inputs that look fine. The exclusion is the whole safety property
 *     and it is tested against the real rows, verbatim.
 *
 *  3. **The policy's hidden premise.** "Pack weight = the average of the invoice
 *     weights" silently assumes one of OUR packs is one ANGEL unit. On fresh chives
 *     it is half of one. `classifyPackPremise` is what turns that from a 2x error
 *     into a refusal, so its boundaries are tested from both sides.
 *
 * Plus the parser, which is the usual silent-shear risk: the purchase history's
 * dates ("Aug 14, 2026") and several product names contain commas, so a naive split
 * would shift every numeric column by one and still parse.
 */
import { describe, it, expect } from "vitest";
import {
  parsePurchaseHistory, purchaseRowKey, invoiceAverageLbs, classifyPackPremise, lbsToPackOz,
  VENDOR_BINDINGS, DRIED_CHIVES_PACK, BEEF_BASE_CANDIDATES, BEEF_BASE_PACK, BEEF_BASE_RULING,
  LETTUCE_PAIR, PFG_LETTUCE_CANDIDATES,
  VARIABLE_CATCH_RULES, BASIL_DUPLICATE_CLUSTER, GARLIC_RATIFICATION,
  HERB_WEIGHT_POLICY, AVERAGE_DEFINITION, WEIGHT_CLASS_MEANING, CONSTANT_WEIGHT_SPREAD_CEILING,
  WEIGHT_CLASS_RANK, isMeasuredWeightClass, ESTIMATE_CLASS_RATIFICATION,
  STILL_STUCK, WAVE4_REASONS,
  type Wave4Code, type WeightClass,
} from "@/lib/angel-wave4";

const HEADER =
  "date,product,brand,manufacturer,vendor,pack_size,quantity,unit_price_per_case,price_per_lb,net_weight_lbs,lbs_per_unit,weight_source,line_total";

/** The four REAL `BASIL FRSH` [PEAK FRS] lines, verbatim from docs/angel-purchase-history.csv. */
const BASIL_MEASURED = [
  `"Aug 14, 2026",BASIL FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/1 LB,2.0,20.25,13.97,2.899,1.4495,invoice_catch_weight,40.5`,
  `"Aug 7, 2026",BASIL FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/1 LB,1.0,19.55,13.48,1.45,1.45,invoice_catch_weight,19.55`,
  `"Jul 31, 2026",BASIL FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/1 LB,2.0,19.55,13.48,2.901,1.4505,invoice_catch_weight,39.1`,
  `"Jul 24, 2026",BASIL FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/1 LB,2.0,19.55,13.48,2.901,1.4505,invoice_catch_weight,39.1`,
];

/** Three of the seven FABRICATED `BASIL FRSH` [FRSH ADV] lines — note the identical pack string. */
const BASIL_FABRICATED = [
  `"Aug 14, 2026",BASIL FRSH,FRSH ADV,THE CLASS PRODUCE GROUP,PFG,1/1 LB,4.0,10.34,10.34,4.0,1.0,assumed_default_1lb,41.36`,
  `"Aug 7, 2026",BASIL FRSH,FRSH ADV,THE CLASS PRODUCE GROUP,PFG,1/1 LB,2.0,10.34,10.34,2.0,1.0,assumed_default_1lb,20.68`,
  `"Jul 31, 2026",BASIL FRSH,FRSH ADV,THE CLASS PRODUCE GROUP,PFG,1/1 LB,3.0,10.34,10.34,3.0,1.0,assumed_default_1lb,31.02`,
];

/** A product name containing a comma — the parser's shear case. */
const COMMA_NAMED =
  `"Jul 10, 2026","Basil, Fresh Herb",Cross Valley Farms,Cross Valley Farms,US Foods,1 LB,1.0,16.08,16.08,1.0,1.0,assumed_default_1lb,16.08`;

const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

// ── The parser ─────────────────────────────────────────────────────────────────

describe("parsePurchaseHistory", () => {
  it("keeps quoted commas inside one field rather than shearing the numeric columns", () => {
    const rows = parsePurchaseHistory(csv(COMMA_NAMED));
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    // The failure mode this guards: a naive split gives product="Basil" and shifts
    // every column right, so `quantity` would read "Fresh Herb" -> null and the
    // whole average would silently drop the line.
    expect(r.product).toBe("Basil, Fresh Herb");
    expect(r.date).toBe("Jul 10, 2026");
    expect(r.vendor).toBe("US Foods");
    expect(r.quantity).toBe(1);
    expect(r.unitPricePerCase).toBe(16.08);
    expect(r.weightSource).toBe("assumed_default_1lb");
    expect(r.lineTotal).toBe(16.08);
  });

  it("is header-driven — column ORDER is never assumed", () => {
    const swapped = ["vendor,product,brand,manufacturer,pack_size,date,quantity,unit_price_per_case,price_per_lb,net_weight_lbs,lbs_per_unit,weight_source,line_total",
      `PFG,BASIL FRSH,PEAK FRS,RUBY CO EUREKA,1/1 LB,"Aug 14, 2026",2.0,20.25,13.97,2.899,1.4495,invoice_catch_weight,40.5`].join("\n");
    const r = parsePurchaseHistory(swapped)[0]!;
    expect(r.product).toBe("BASIL FRSH");
    expect(r.vendor).toBe("PFG");
    expect(r.lbsPerUnit).toBe(1.4495);
  });

  it("throws rather than guessing when an expected column is absent", () => {
    expect(() => parsePurchaseHistory("date,product\nx,y")).toThrow(/expected column/);
  });

  it("returns an empty array for empty input", () => {
    expect(parsePurchaseHistory("")).toEqual([]);
  });

  it("reads an em-dash as null rather than NaN", () => {
    const rows = parsePurchaseHistory(csv(
      `"Aug 10, 2026",5 GALLON GARLIC PICKLES,—,—,Delmar Provisions,—,4.0,35.95,35.95,4.0,1.0,assumed_default_1lb,143.8`,
    ));
    expect(rows[0]!.brand).toBe("—");
    expect(rows[0]!.quantity).toBe(4);
  });
});

describe("purchaseRowKey", () => {
  it("separates the two BASIL FRSH rows, which share a name AND a pack string", () => {
    const [measured] = parsePurchaseHistory(csv(BASIL_MEASURED[0]!));
    const [fabricated] = parsePurchaseHistory(csv(BASIL_FABRICATED[0]!));
    // If the key ignored brand, the fabricated rows would join into the measured
    // average and nothing about the inputs would look wrong.
    expect(purchaseRowKey(measured!)).not.toBe(purchaseRowKey(fabricated!));
    expect(purchaseRowKey(measured!)).toBe("BASIL FRSH | PEAK FRS | PFG | 1/1 LB");
  });

  it("is whitespace-insensitive so a padded CSV cell still joins", () => {
    expect(purchaseRowKey({ product: " A ", brand: "B ", vendor: " C", packSize: "D" }))
      .toBe(purchaseRowKey({ product: "A", brand: "B", vendor: "C", packSize: "D" }));
  });
});

// ── The invoice average — the function the policy names ────────────────────────

describe("invoiceAverageLbs", () => {
  it("reproduces the real basil average from the real lines", () => {
    const avg = invoiceAverageLbs(parsePurchaseHistory(csv(...BASIL_MEASURED)))!;
    expect(avg).not.toBeNull();
    expect(avg.lines).toBe(4);
    expect(avg.units).toBe(7); // 2 + 1 + 2 + 2
    expect(avg.totalLbs).toBeCloseTo(10.151, 6);
    // 10.151 / 7 — the quantity-weighted value of record.
    expect(avg.meanLbs).toBeCloseTo(1.4501428571, 9);
    expect(avg.minLbs).toBe(1.4495);
    expect(avg.maxLbs).toBe(1.4505);
    expect(avg.excludedNonMeasured).toBe(0);
    // And the number that actually reaches the database.
    expect(lbsToPackOz(avg.meanLbs)).toBe(23.2);
  });

  it("computes BOTH averages, and they differ — which is why the definition is pinned", () => {
    const avg = invoiceAverageLbs(parsePurchaseHistory(csv(...BASIL_MEASURED)))!;
    // Unweighted: (1.4495 + 1.45 + 1.4505 + 1.4505) / 4.
    expect(avg.meanUnweightedLbs).toBeCloseTo(1.450125, 9);
    expect(avg.meanLbs).not.toBe(avg.meanUnweightedLbs);
    // They agree to well under a hundredth of a percent TODAY. That closeness is
    // the hazard: a silent switch between the two would never be noticed by eye.
    expect(Math.abs(avg.meanUnweightedLbs / avg.meanLbs - 1)).toBeLessThan(0.0001);
    expect(AVERAGE_DEFINITION).toMatch(/quantity-weighted/);
  });

  it("weights by quantity, provably — a heavy single-unit line must not outvote a light bulk line", () => {
    // Two lines: 1 unit at 3 lb, and 9 units at 1 lb each.
    const rows = parsePurchaseHistory(csv(
      `"Aug 14, 2026",X,B,M,V,1 LB,1.0,10,10,3.0,3.0,invoice_catch_weight,10`,
      `"Aug 7, 2026",X,B,M,V,1 LB,9.0,10,10,9.0,1.0,invoice_catch_weight,90`,
    ));
    const avg = invoiceAverageLbs(rows)!;
    expect(avg.meanUnweightedLbs).toBeCloseTo(2.0, 9); // (3 + 1) / 2 — the wrong answer
    expect(avg.meanLbs).toBeCloseTo(1.2, 9); // 12 lb / 10 units — the right one
  });

  it("EXCLUDES Angel's fabricated 1.0 lb lines — the basil trap", () => {
    const mixed = parsePurchaseHistory(csv(...BASIL_MEASURED, ...BASIL_FABRICATED));
    const avg = invoiceAverageLbs(mixed)!;
    expect(avg.lines).toBe(4);
    expect(avg.excludedNonMeasured).toBe(3);
    // Unchanged by the presence of the fabricated siblings.
    expect(avg.meanLbs).toBeCloseTo(1.4501428571, 9);
    // What blending them would have produced — a plausible number that is wrong.
    const blended = (10.151 + 9.0) / (7 + 9);
    expect(blended).toBeCloseTo(1.1969375, 6);
    expect(avg.meanLbs).not.toBeCloseTo(blended, 3);
  });

  it("returns NULL when every line is fabricated, rather than a confident wrong number", () => {
    expect(invoiceAverageLbs(parsePurchaseHistory(csv(...BASIL_FABRICATED)))).toBeNull();
  });

  it("returns NULL for no rows at all", () => {
    expect(invoiceAverageLbs([])).toBeNull();
  });

  it("drops rows with a missing or non-positive quantity/weight instead of dividing by zero", () => {
    const rows = parsePurchaseHistory(csv(
      `"Aug 14, 2026",X,B,M,V,1 LB,0,10,10,0,0,invoice_catch_weight,0`,
      `"Aug 7, 2026",X,B,M,V,1 LB,2.0,10,10,4.0,2.0,invoice_catch_weight,20`,
    ));
    const avg = invoiceAverageLbs(rows)!;
    expect(avg.lines).toBe(1);
    expect(avg.excludedNonMeasured).toBe(1);
    expect(avg.meanLbs).toBe(2);
    expect(Number.isFinite(avg.meanLbs)).toBe(true);
  });

  it("reports a ZERO spread when a weight never moved, and a nonzero one when it did", () => {
    // Fresh chives: 0.81 lb on every one of its lines.
    const chives = invoiceAverageLbs(parsePurchaseHistory(csv(
      `"Aug 14, 2026",CHIVES FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/8 OZ,2.0,17.88,22.07,1.62,0.81,invoice_catch_weight,35.76`,
      `"Aug 7, 2026",CHIVES FRSH,PEAK FRS,RUBY CO EUREKA,PFG,1/8 OZ,1.0,17.88,22.07,0.81,0.81,invoice_catch_weight,17.88`,
    )))!;
    expect(chives.spreadFraction).toBe(0);

    const basil = invoiceAverageLbs(parsePurchaseHistory(csv(...BASIL_MEASURED)))!;
    expect(basil.spreadFraction).toBeGreaterThan(0);
    expect(basil.spreadFraction).toBeCloseTo((1.4505 - 1.4495) / basil.meanLbs, 9);
  });

  it("keeps the constant-weight ceiling at EXACTLY zero", () => {
    // Basil's real spread is 6.9e-4. Any tolerance loose enough to call that
    // "constant" erases the one signal that separates a weighed number from a
    // stored one — so the ceiling is the identity, not a tuned threshold.
    const basil = invoiceAverageLbs(parsePurchaseHistory(csv(...BASIL_MEASURED)))!;
    expect(CONSTANT_WEIGHT_SPREAD_CEILING).toBe(0);
    expect(basil.spreadFraction).toBeGreaterThan(CONSTANT_WEIGHT_SPREAD_CEILING);
  });
});

// ── The policy's hidden premise ────────────────────────────────────────────────

describe("classifyPackPremise", () => {
  it("accepts our pack when it IS one Angel unit (basil, thyme, parsley, garlic)", () => {
    expect(classifyPackPremise(16, 16)).toBe("OUR_PACK_IS_THE_ANGEL_UNIT");
    expect(classifyPackPremise(4, 4)).toBe("OUR_PACK_IS_THE_ANGEL_UNIT");
    expect(classifyPackPremise(80, 80)).toBe("OUR_PACK_IS_THE_ANGEL_UNIT");
  });

  it("catches the fresh-chives case: our 4 oz pack is HALF an 8 oz Angel unit", () => {
    expect(classifyPackPremise(4, 8)).toBe("OUR_PACK_IS_A_FRACTION");
  });

  it("reports a non-whole relation as broken rather than rounding it to a fraction", () => {
    expect(classifyPackPremise(16, 23.2)).toBe("PREMISE_BROKEN");
    expect(classifyPackPremise(10, 25)).toBe("PREMISE_BROKEN");
  });

  it("treats a null, zero or non-finite side as broken, never as a match", () => {
    expect(classifyPackPremise(null, 16)).toBe("PREMISE_BROKEN");
    expect(classifyPackPremise(16, null)).toBe("PREMISE_BROKEN");
    expect(classifyPackPremise(0, 16)).toBe("PREMISE_BROKEN");
    expect(classifyPackPremise(16, Number.NaN)).toBe("PREMISE_BROKEN");
  });

  it("allows a 2% wobble but not a 10% one", () => {
    expect(classifyPackPremise(16, 16.3)).toBe("OUR_PACK_IS_THE_ANGEL_UNIT"); // +1.9%
    expect(classifyPackPremise(16, 17.6)).toBe("PREMISE_BROKEN"); // +10%
  });
});

describe("lbsToPackOz", () => {
  it("converts and rounds to two places without inventing precision", () => {
    expect(lbsToPackOz(1.4501428571)).toBe(23.2);
    expect(lbsToPackOz(0.47)).toBe(7.52);
    expect(lbsToPackOz(1.39975)).toBe(22.4);
    expect(lbsToPackOz(5.9960476)).toBe(95.94);
  });

  it("throws on a non-positive or non-finite input rather than emitting a nonsense pack", () => {
    expect(() => lbsToPackOz(0)).toThrow();
    expect(() => lbsToPackOz(-1)).toThrow();
    expect(() => lbsToPackOz(Number.NaN)).toThrow();
  });
});

// ── The constants that carry Juan's rulings ────────────────────────────────────

describe("the wave-4 rulings, as constants", () => {
  it("binds exactly the four SKUs Juan named, each to one vendor", () => {
    expect(VENDOR_BINDINGS.map((b) => b.skuName).sort())
      .toEqual(["Beef Base", "Dried Chives", "Mortadella", "Utz Ripples"]);
    expect(VENDOR_BINDINGS.map((b) => b.vendorName))
      .toEqual(["PFG", "Boar's Head", "Country Snacks", "US Foods"]);
  });

  it("prices the two SKUs Juan supplied a pack for, and every BIND_ONLY row says why", () => {
    const priced = VENDOR_BINDINGS.filter((b) => b.priceIntent === "PRICE_FROM_ANGEL");
    // Beef Base joined this list on 2026-08-20 when Juan ratified the jar model;
    // run 1 refused it for OUR_PACK_UNRESOLVABLE.
    expect(priced.map((b) => b.skuName).sort()).toEqual(["Beef Base", "Dried Chives"]);
    // The two that stay bind-only are the two Angel has never invoiced — a fact no
    // ruling can change, so this pair should not drift.
    expect(VENDOR_BINDINGS.filter((b) => b.angelProduct == null).map((b) => b.skuName).sort())
      .toEqual(["Mortadella", "Utz Ripples"]);
    for (const b of VENDOR_BINDINGS) {
      if (b.priceIntent === "BIND_ONLY") {
        expect(b.whyBindOnly, `${b.skuName} must explain its bind-only status`).toBeTruthy();
      } else {
        expect(b.whyBindOnly).toBeNull();
      }
    }
  });

  it("closes the Dried Chives arithmetic from both directions", () => {
    expect(DRIED_CHIVES_PACK.caseOz).toBe(6.72); // 6 x 1.12
    expect(DRIED_CHIVES_PACK.truePricePerLb).toBeCloseTo(23.142857, 5);
    // Angel prints exactly 6x that — the dropped-multiplier bug, not a rounding gap.
    expect(DRIED_CHIVES_PACK.angelStatedPricePerLb / DRIED_CHIVES_PACK.truePricePerLb).toBeCloseTo(6, 2);
  });

  it("writes the ratified beef-base pack, and records the route it rejected", () => {
    expect(BEEF_BASE_PACK.caseOz).toBe(96); // 6 jars x 16 oz
    expect(BEEF_BASE_PACK.contentPricePerLb).toBeCloseTo(10.435, 3);
    expect(BEEF_BASE_PACK.casePriceUsd / BEEF_BASE_PACK.jarsPerCase).toBeCloseTo(10.435, 3);
    // The tare reading that justifies ignoring Angel's measured weight: 6.703 lb of
    // product-plus-glass against 6.0 lb of product, which is harvest 2's bottle pattern.
    expect(BEEF_BASE_PACK.tareRatio).toBeCloseTo(1.117, 3);
    // And the rejected route, kept computable so the 10.5% gap is auditable rather
    // than asserted in prose.
    expect(BEEF_BASE_PACK.rejectedPerLbRouteUsd).toBeCloseTo(56.04, 2);
    expect(BEEF_BASE_PACK.rejectedPerLbRouteUsd / BEEF_BASE_PACK.casePriceUsd - 1).toBeCloseTo(-0.1049, 3);
    // The ruling names both halves of the decision.
    expect(BEEF_BASE_RULING).toMatch(/MINORS/);
    expect(BEEF_BASE_RULING).toMatch(/gross|GROSS/);
    // The pack we write is the MINORS row, not the competing one.
    expect(BEEF_BASE_PACK.angelProduct).toBe(BEEF_BASE_CANDIDATES[0]!.product);
    expect(BEEF_BASE_PACK.brand).toBe(BEEF_BASE_CANDIDATES[0]!.brand);
  });

  it("keeps both beef-base candidates within 7% per jar — the reason it is a low-stakes question", () => {
    expect(BEEF_BASE_CANDIDATES).toHaveLength(2);
    const [minors, rdg] = BEEF_BASE_CANDIDATES as [typeof BEEF_BASE_CANDIDATES[number], typeof BEEF_BASE_CANDIDATES[number]];
    // MINORS: a 6-pack, so per jar is the case price over six.
    expect(minors.casePriceUsd / 6).toBeCloseTo(minors.impliedPerJarUsd, 2);
    expect(Math.abs(minors.impliedPerJarUsd / rdg.impliedPerJarUsd - 1)).toBeLessThan(0.08);
    // And the glass-tare reading, which is why $/lb is the wrong multiplicand here.
    expect(minors.measuredLbsPerUnit / minors.nominalLbs).toBeCloseTo(1.117, 3);
  });

  it("flags the lettuce primary as an inference and gives the basis", () => {
    expect(LETTUCE_PAIR.primaryIsInferred).toBe(true);
    expect(LETTUCE_PAIR.primaryInferenceBasis).toBeTruthy();
    expect(LETTUCE_PAIR.primary.expectVendor).toBe("Sysco");
    expect(LETTUCE_PAIR.backup.expectVendor).toBe("Baldor");
  });

  it("records that NONE of Angel's lettuce rows belongs to either twin", () => {
    const twins = new Set<string>([LETTUCE_PAIR.primary.expectVendor, LETTUCE_PAIR.backup.expectVendor]);
    expect(PFG_LETTUCE_CANDIDATES.length).toBeGreaterThan(0);
    for (const c of PFG_LETTUCE_CANDIDATES) {
      expect(twins.has(c.vendor), `${c.product} must not be attributable to a twin`).toBe(false);
    }
    const spend = PFG_LETTUCE_CANDIDATES.reduce((a, c) => a + c.totalSpendUsd, 0);
    expect(spend).toBeCloseTo(3230.74, 2);
  });

  it("resolves the basil duplicate to exactly one usable row, and only on weight_source", () => {
    const used = BASIL_DUPLICATE_CLUSTER.filter((c) => c.verdict === "USE");
    expect(used).toHaveLength(1);
    expect(used[0]!.brand).toBe("PEAK FRS");
    expect(used[0]!.weightSource).toBe("invoice_catch_weight");
    // Every rejected row is rejected for a fabricated weight — never for its price,
    // which is the trap: the rejected FRSH ADV row is the CHEAPEST of the three.
    for (const c of BASIL_DUPLICATE_CLUSTER.filter((x) => x.verdict === "REJECT")) {
      expect(c.weightSource).toMatch(/^assumed/);
    }
    const cheapest = [...BASIL_DUPLICATE_CLUSTER].sort((a, b) => a.casePriceUsd - b.casePriceUsd)[0]!;
    expect(cheapest.verdict).toBe("REJECT");
  });

  it("leaves NO variable-catch rule scale-gated after the garlic ratification", () => {
    // Run 1 held garlic here. Juan ratified the fingerprint argument on 2026-08-20,
    // so the gate narrowed to oregano + onion powder — neither of which is in this
    // table at all. If a row ever gets re-flagged, this test is how you find out.
    expect(VARIABLE_CATCH_RULES.filter((r) => r.scaleGated)).toEqual([]);
    // The original ruling is kept verbatim, amendment recorded separately — a ruling
    // edited in place is a ruling nobody can audit.
    expect(HERB_WEIGHT_POLICY).toMatch(/SCALE-GATED/);
    expect(GARLIC_RATIFICATION).toMatch(/ONLY oregano and onion powder/);
    expect(GARLIC_RATIFICATION).toMatch(/VARIES/);
  });

  it("narrows the scale gate in the ledger to the two jugs, with garlic gone from it", () => {
    const gated = STILL_STUCK.filter((s) => s.category === "SCALE_GATED");
    expect(gated).toHaveLength(1);
    expect(gated[0]!.item).toMatch(/Oregano/);
    expect(gated[0]!.item).toMatch(/Onion Powder/);
    for (const s of STILL_STUCK) {
      expect(s.item.startsWith("Garlic"), "garlic must no longer be a stuck item").toBe(false);
    }
  });

  it("gives every variable-catch rule a unique Angel-row identity", () => {
    const keys = VARIABLE_CATCH_RULES.map((r) => purchaseRowKey({ ...r, packSize: r.packSizeRaw }));
    expect(new Set(keys).size).toBe(VARIABLE_CATCH_RULES.length);
  });

  it("names all four weight classes, distinctly", () => {
    // ESTIMATE joined 2026-08-21 (Juan's ruling). The vocabulary is a closed set
    // in TypeScript even though the COLUMN is unconstrained text (0177 precedent),
    // so this list and the type must not drift apart.
    const classes: WeightClass[] = ["OPERATIONAL", "SPEC", "INVOICE_DERIVED", "ESTIMATE"];
    for (const c of classes) expect(WEIGHT_CLASS_MEANING[c]).toBeTruthy();
    expect(Object.keys(WEIGHT_CLASS_MEANING).sort()).toEqual([...classes].sort());
    expect(new Set(Object.values(WEIGHT_CLASS_MEANING)).size).toBe(4);
  });

  it("ranks ESTIMATE below SPEC, and SPEC below both measured classes", () => {
    // The ladder IS the ruling: measured (scale) > documented (label) > guessed.
    expect(WEIGHT_CLASS_RANK.ESTIMATE).toBeLessThan(WEIGHT_CLASS_RANK.SPEC);
    expect(WEIGHT_CLASS_RANK.SPEC).toBeLessThan(WEIGHT_CLASS_RANK.OPERATIONAL);
    expect(WEIGHT_CLASS_RANK.SPEC).toBeLessThan(WEIGHT_CLASS_RANK.INVOICE_DERIVED);
  });

  it("holds OPERATIONAL and INVOICE_DERIVED as PEERS — different scales, same standing", () => {
    // Deliberately equal. Ordering them would assert a preference nobody ruled.
    expect(WEIGHT_CLASS_RANK.OPERATIONAL).toBe(WEIGHT_CLASS_RANK.INVOICE_DERIVED);
  });

  it("gives every class a rank, and only the measured pair clears the floor", () => {
    for (const c of Object.keys(WEIGHT_CLASS_MEANING) as WeightClass[]) {
      expect(WEIGHT_CLASS_RANK[c], `${c} needs a rank`).toBeTypeOf("number");
    }
    expect(isMeasuredWeightClass("OPERATIONAL")).toBe(true);
    expect(isMeasuredWeightClass("INVOICE_DERIVED")).toBe(true);
    expect(isMeasuredWeightClass("SPEC")).toBe(false);
    expect(isMeasuredWeightClass("ESTIMATE")).toBe(false);
  });

  it("refuses to call an unclassed or unknown weight measured", () => {
    // NULL is the honest absence (0161 LOCK-1) and must never read as a claim of
    // measurement. An unrecognised term gets the same conservative answer — the
    // column is open text so the vocabulary CAN grow, and a term this build has
    // never heard of has not earned the benefit of the doubt.
    expect(isMeasuredWeightClass(null)).toBe(false);
    expect(isMeasuredWeightClass("SOMETHING_A_LATER_WAVE_MINTED")).toBe(false);
    expect(isMeasuredWeightClass("")).toBe(false);
    // Not case-insensitive: the value written is the English original, verbatim.
    expect(isMeasuredWeightClass("operational")).toBe(false);
  });

  it("records the ESTIMATE ratification verbatim, dated, and attributed", () => {
    expect(ESTIMATE_CLASS_RATIFICATION).toContain("2026-08-21");
    expect(ESTIMATE_CLASS_RATIFICATION).toContain("Juan");
    expect(WEIGHT_CLASS_MEANING.ESTIMATE).toMatch(/educated guess/i);
  });

  it("gives every refusal code prose, and every stuck item an unblock", () => {
    const codes: Wave4Code[] = [
      "SKU_UNRESOLVED", "VENDOR_DRIFT", "VENDOR_UNREGISTERED", "ALREADY_CORRECT",
      "OUR_PACK_UNRESOLVABLE", "PACK_SHAPE_CHANGED", "NO_ANGEL_ROW", "SCALE_GATED",
      "PACK_PREMISE_BROKEN", "NO_MEASURED_INVOICE_WEIGHT", "ATTRIBUTION_UNRESOLVED", "PAR_ABSENT",
    ];
    for (const c of codes) expect(WAVE4_REASONS[c], `${c} needs a reason`).toBeTruthy();
    expect(Object.keys(WAVE4_REASONS).sort()).toEqual([...codes].sort());

    expect(STILL_STUCK.length).toBeGreaterThan(0);
    for (const s of STILL_STUCK) {
      expect(s.stuckOn, `${s.item} needs a blocker`).toBeTruthy();
      expect(s.unblock, `${s.item} needs an unblock`).toBeTruthy();
    }
  });

  it("names the 8 unadjudicated pairs in the ledger, so the list stops living in a transcript", () => {
    const pairRow = STILL_STUCK.find((s) => s.category === "UNADJUDICATED_PAIR")!;
    for (const name of ["Turkey", "Roast Beef", "Provolone", "Capicola", "Pepperoni", "Banana Peppers", "Hot Peppers", "Sweet Peppers"]) {
      expect(pairRow.item, `${name} must appear in the enumerated pair list`).toContain(name);
    }
  });
});
