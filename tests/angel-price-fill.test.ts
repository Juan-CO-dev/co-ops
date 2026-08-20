/**
 * Unit spine — lib/angel-price-fill.ts (the Angel catalog → pack-price math).
 *
 * These tests exist because the failure they guard against is silent and expensive.
 * `vendor_price_history.unit_price` is the price of ONE OF OUR PACKS; Angel quotes
 * the price of ONE OF ITS CASES. A regression that drops the divisor does not throw
 * and does not look wrong in the UI — it just makes Ham cost 13× and Butter 36×
 * what they actually cost, and every recipe, plate cost and variance figure
 * downstream inherits the error.
 */
import { describe, it, expect } from "vitest";
import {
  computePackUnitPrice, exactQuotient, classify, buildSourceNote, rowKey,
  parseCsvLine, parseAngelCatalog, DIVISION_RULES,
  type AngelCatalogRow,
} from "@/lib/angel-price-fill";

function row(over: Partial<AngelCatalogRow> = {}): AngelCatalogRow {
  return { product: "X", brand: "B", vendor: "PFG", packSizeRaw: "1/1 LB", casePriceUsd: 10, totalSpendUsd: 100, flags: [], ...over };
}

/** Build a catalog row that matches a DIVISION_RULES entry by index. */
function rowForRule(i: number, over: Partial<AngelCatalogRow> = {}): AngelCatalogRow {
  const r = DIVISION_RULES[i]!;
  return row({ product: r.product, brand: r.brand, vendor: r.vendor, packSizeRaw: r.packSizeRaw, ...over });
}

describe("computePackUnitPrice — the divisor is the whole job", () => {
  it("divides the Ham case price by 13 (the report's worked example)", () => {
    // $36.06 for a 1/13 LB case (208 oz); our pack is 16 oz.
    // Writing the case price straight through would overstate ham cost 13×.
    expect(computePackUnitPrice(36.06, 13)).toBe(2.77);
  });

  it("divides Butter by 36 — the largest divisor in the table", () => {
    expect(computePackUnitPrice(81.11, 36)).toBe(2.25);
  });

  it("passes a PACK-AGREES case price through unchanged at divisor 1", () => {
    expect(computePackUnitPrice(49.2, 1)).toBe(49.2);
    expect(computePackUnitPrice(19.72, 1)).toBe(19.72);
  });

  it("reproduces every divided price in the report's CASE-MULTIPLE table", () => {
    expect(computePackUnitPrice(23.9, 2)).toBe(11.95);   // Ground Pork
    expect(computePackUnitPrice(85.14, 6)).toBe(14.19);  // Shredded Mozz
    expect(computePackUnitPrice(35.46, 10)).toBe(3.55);  // Cheddar (sharp block)
    expect(computePackUnitPrice(62.83, 9)).toBe(6.98);   // Salt
    expect(computePackUnitPrice(55.27, 4)).toBe(13.82);  // Oregano
    expect(computePackUnitPrice(51.73, 10)).toBe(5.17);  // Cheddar (med loaf)
    expect(computePackUnitPrice(33.25, 5)).toBe(6.65);   // Onion Powder
  });

  describe("half-cent ties — the two real ones, where naive rounding drifts", () => {
    it("rounds Tuna's 11.985 UP to 11.99", () => {
      expect(exactQuotient(71.91, 6)).toBeCloseTo(11.985, 10);
      expect(computePackUnitPrice(71.91, 6)).toBe(11.99);
    });

    it("rounds Ricotta's 34.095 UP to 34.10", () => {
      expect(exactQuotient(68.19, 2)).toBe(34.095);
      expect(computePackUnitPrice(68.19, 2)).toBe(34.1);
    });

    it("scales decimal-exactly, so a value where *100 loses a cent still rounds up", () => {
      // Today's two real ties scale cleanly, but `x * 100` is not exact in general:
      // 1.005 * 100 === 100.49999999999999, which would round DOWN and drop a cent.
      // This pins the string/exponent scaling that avoids it, for the next export's
      // numbers rather than this one's.
      expect(1.005 * 100).toBeLessThan(100.5);
      expect(computePackUnitPrice(2.01, 2)).toBe(1.01);
    });
  });

  it("refuses a nonsense price or divisor rather than emitting one", () => {
    expect(() => computePackUnitPrice(0, 2)).toThrow(/positive finite/);
    expect(() => computePackUnitPrice(-5, 2)).toThrow(/positive finite/);
    expect(() => computePackUnitPrice(Number.NaN, 2)).toThrow(/positive finite/);
    expect(() => computePackUnitPrice(10, 0)).toThrow(/divisor/);
    expect(() => computePackUnitPrice(10, -1)).toThrow(/divisor/);
  });
});

describe("rowKey — product name alone is not an identity", () => {
  it("separates the two BASIL FRSH rows that differ only by brand", () => {
    const a = rowKey({ product: "BASIL FRSH", brand: "FRSH ADV", vendor: "PFG", packSizeRaw: "1/1 LB" });
    const b = rowKey({ product: "BASIL FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB" });
    expect(a).not.toBe(b);
  });

  it("separates the two OREGANO LEAVES rows that differ only by pack size", () => {
    const a = rowKey({ product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/5 LB" });
    const b = rowKey({ product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/24 OZ" });
    expect(a).not.toBe(b);
  });
});

describe("DIVISION_RULES — the transcribed table", () => {
  it("holds the report's 12 PACK-AGREES + 18 CASE-MULTIPLE rows", () => {
    expect(DIVISION_RULES).toHaveLength(30);
    expect(DIVISION_RULES.filter((r) => r.relation === "PACK_AGREES")).toHaveLength(12);
    expect(DIVISION_RULES.filter((r) => r.relation === "CASE_MULTIPLE")).toHaveLength(18);
  });

  it("keeps every divisor internally consistent with the two oz figures", () => {
    // The divisor is not free-floating: it must equal angelCaseOz / ourPackOz.
    // A typo in any of the three numbers surfaces here. Tolerance is RELATIVE (1%)
    // because one rule legitimately misses exactness — see the Tuna test below.
    for (const r of DIVISION_RULES) {
      const implied = r.angelCaseOz / r.ourPackOz;
      expect(Math.abs(implied - r.divisor) / r.divisor).toBeLessThan(0.01);
    }
  });

  it("documents Tuna as the one rule whose oz figures do not divide exactly", () => {
    // 399 / 66.6 = 5.991, not 6 — because our recorded 66.6 oz/can is a stale
    // estimate and Angel's parse confirms 66.5 (report W4). The divisor of 6 (cans
    // per case) is correct either way and the price is unaffected. If someone later
    // corrects the SKU to 66.5, this test should start failing and be deleted.
    const tuna = DIVISION_RULES.find((r) => r.product === "TUNA CHNK LIGHT CHN")!;
    expect(tuna.ourPackOz).toBe(66.6);
    expect(tuna.angelCaseOz / tuna.ourPackOz).not.toBe(6);
    expect(tuna.angelCaseOz / 66.5).toBe(6);
  });

  it("pins PACK_AGREES to divisor 1 and CASE_MULTIPLE to more than 1", () => {
    for (const r of DIVISION_RULES) {
      if (r.relation === "PACK_AGREES") expect(r.divisor).toBe(1);
      else expect(r.divisor).toBeGreaterThan(1);
    }
  });

  it("has no duplicate row keys", () => {
    const keys = DIVISION_RULES.map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("classify — refusals", () => {
  it("refuses every Delmar row, matched or not, for having no denominator", () => {
    const rows = [
      row({ product: "OVENGOLD TURKEY", vendor: "Delmar Provisions", packSizeRaw: "", casePriceUsd: 58.48, flags: ["NO_PACK_SIZE", "BROKER_DIRECT"] }),
      row({ product: "PICKLES CHIPS 1/4", vendor: "Delmar Provisions", packSizeRaw: "", casePriceUsd: 35.95, flags: ["NO_PACK_SIZE", "BROKER_DIRECT"] }),
    ];
    const { fills, refusals } = classify(rows);
    expect(fills).toHaveLength(0);
    expect(refusals.map((r) => r.code)).toEqual(["DELMAR_NO_PACK_SIZE", "DELMAR_NO_PACK_SIZE"]);
  });

  it("refuses HIGH_PPL_REVIEW rows even when a divisor exists for them", () => {
    // CHIVES FRSH sits in the CASE-MULTIPLE table (÷2) AND is flagged. The flag wins.
    const chives = DIVISION_RULES.find((r) => r.product === "CHIVES FRSH")!;
    const { fills, refusals } = classify([
      row({ product: chives.product, brand: chives.brand, vendor: chives.vendor, packSizeRaw: chives.packSizeRaw, casePriceUsd: 17.88, flags: ["HIGH_PPL_REVIEW"] }),
    ]);
    expect(fills).toHaveLength(0);
    expect(refusals[0]!.code).toBe("HIGH_PPL_REVIEW");
  });

  it("refuses US Foods rows as historical, never as the price of record", () => {
    const usf = DIVISION_RULES.find((r) => r.vendor === "US Foods")!;
    const { fills, refusals } = classify([rowForRule(DIVISION_RULES.indexOf(usf), { casePriceUsd: 41.57 })]);
    expect(fills).toHaveLength(0);
    expect(refusals[0]!.code).toBe("US_FOODS_HISTORICAL");
  });

  it("refuses the unresolved 50/50 blend rather than pricing Shredded Mozz from it", () => {
    const blend = DIVISION_RULES.find((r) => r.product === "CHEESE MOZZ PROV 50/50 SHRED")!;
    const { fills, refusals } = classify([rowForRule(DIVISION_RULES.indexOf(blend), { casePriceUsd: 81.71 })]);
    expect(fills).toHaveLength(0);
    expect(refusals[0]!.code).toBe("AMBIGUOUS_PRODUCT_IDENTITY");
  });

  it("refuses BOTH rows when two live PFG quotes hit one SKU (89% Basil spread)", () => {
    const basils = DIVISION_RULES.filter((r) => r.product === "BASIL FRSH");
    expect(basils).toHaveLength(2);
    const rows = basils.map((b, i) => row({ product: b.product, brand: b.brand, vendor: b.vendor, packSizeRaw: b.packSizeRaw, casePriceUsd: i === 0 ? 10.34 : 19.55 }));
    const { fills, refusals } = classify(rows);
    expect(fills).toHaveLength(0);
    expect(refusals.map((r) => r.code)).toEqual(["DUPLICATE_CLUSTER", "DUPLICATE_CLUSTER"]);
  });

  it("does NOT let a refused US Foods row create a false duplicate cluster", () => {
    // Ricotta is quoted by one PFG row and one US Foods row. The USF row is refused
    // first, so the PFG row must survive as a clean fill — counting it as a cluster
    // would throw away a good price because a row we already reject named the SKU.
    const pfg = DIVISION_RULES.find((r) => r.product === "CHEESE RICOTTA IMPASTATA WM")!;
    const usf = DIVISION_RULES.find((r) => r.product.startsWith("Cheese, Ricotta Impastata"))!;
    const { fills, refusals } = classify([
      row({ product: pfg.product, brand: pfg.brand, vendor: pfg.vendor, packSizeRaw: pfg.packSizeRaw, casePriceUsd: 68.19 }),
      row({ product: usf.product, brand: usf.brand, vendor: usf.vendor, packSizeRaw: usf.packSizeRaw, casePriceUsd: 41.57 }),
    ]);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.rule.skuName).toBe("Ricotta");
    expect(fills[0]!.unitPrice).toBe(34.1);
    expect(refusals.map((r) => r.code)).toEqual(["US_FOODS_HISTORICAL"]);
  });

  it("treats a row absent from the division table as not-a-candidate, never inferring a divisor", () => {
    const { fills, refusals, notCandidates } = classify([
      row({ product: "SOMETHING WE DO NOT PRICE", vendor: "PFG", casePriceUsd: 99 }),
    ]);
    expect(fills).toHaveLength(0);
    expect(refusals).toHaveLength(0);
    expect(notCandidates).toHaveLength(1);
  });

  it("drops a candidate whose case price is missing rather than writing a zero", () => {
    const ham = DIVISION_RULES.find((r) => r.product === "HAM 35% WATER FC 4X6 TFF")!;
    const { fills, notCandidates } = classify([rowForRule(DIVISION_RULES.indexOf(ham), { casePriceUsd: null })]);
    expect(fills).toHaveLength(0);
    expect(notCandidates).toHaveLength(1);
  });
});

describe("classify — the fill path", () => {
  it("produces the Ham fill with the full derivation attached", () => {
    const ham = DIVISION_RULES.find((r) => r.product === "HAM 35% WATER FC 4X6 TFF")!;
    const { fills } = classify([rowForRule(DIVISION_RULES.indexOf(ham), { casePriceUsd: 36.06 })]);
    expect(fills).toHaveLength(1);
    const f = fills[0]!;
    expect(f.rule.skuName).toBe("Ham");
    expect(f.rule.divisor).toBe(13);
    expect(f.unitPrice).toBe(2.77);
    expect(f.casePriceUsd).toBe(36.06);
  });
});

describe("buildSourceNote — provenance a human can audit", () => {
  it("names the Angel row and shows the division for a divided fill", () => {
    const ham = DIVISION_RULES.find((r) => r.product === "HAM 35% WATER FC 4X6 TFF")!;
    const { fills } = classify([rowForRule(DIVISION_RULES.indexOf(ham), { casePriceUsd: 36.06 })]);
    const note = buildSourceNote(fills[0]!);
    expect(note).toContain("HAM 35% WATER FC 4X6 TFF");
    expect(note).toContain("1/13 LB");
    expect(note).toContain("÷ 13");
    expect(note).toContain("$2.77");
  });

  it("says explicitly that no division happened on a PACK-AGREES fill", () => {
    const beef = DIVISION_RULES.find((r) => r.product === "BEEF GRND BULK 80/20")!;
    const { fills } = classify([rowForRule(DIVISION_RULES.indexOf(beef), { casePriceUsd: 49.2 })]);
    expect(buildSourceNote(fills[0]!)).toContain("no division");
  });

  it("discloses the unrounded quotient when rounding moved the number", () => {
    const tuna = DIVISION_RULES.find((r) => r.product === "TUNA CHNK LIGHT CHN")!;
    const { fills } = classify([rowForRule(DIVISION_RULES.indexOf(tuna), { casePriceUsd: 71.91 })]);
    const note = buildSourceNote(fills[0]!);
    expect(note).toContain("11.985");
    expect(note).toContain("rounded to cents");
  });
});

describe("parseCsvLine — the export really does contain these shapes", () => {
  it("splits a plain row", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted product names", () => {
    // A naive split(",") shears this row and mis-prices whatever lands in the wrong column.
    expect(parseCsvLine('"Ham, Cooked Rectangle 4x6",Patuxent,US Foods')).toEqual(["Ham, Cooked Rectangle 4x6", "Patuxent", "US Foods"]);
  });

  it('unescapes a doubled quote (the Onion, Yellow Jumbo 3""+ row)', () => {
    expect(parseCsvLine('"Onion, Yellow Jumbo 3""+ Fresh Ref Bag",x')).toEqual(['Onion, Yellow Jumbo 3"+ Fresh Ref Bag', "x"]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsvLine("a,,")).toEqual(["a", "", ""]);
  });
});

describe("parseAngelCatalog", () => {
  const HEADER = "product,brand,manufacturer,vendor,pack_size_raw,class,latest_price_per_case_usd,case_price_delta_pct,price_per_lb_delta_pct,total_spend_usd,est_units_per_case,est_unit_size,est_uom,est_case_weight_lb,est_dimension,est_price_per_lb_usd,flags";

  it("reads columns by header name, not by position", () => {
    const rows = parseAngelCatalog(`${HEADER}\nHAM 35% WATER FC 4X6 TFF,ROMA,AL & JOHN INC,PFG,1/13 LB,DELI,36.06,-0.6%,-0.6%,2164.94,1,13,LB,13.0,weight,2.7738,`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ product: "HAM 35% WATER FC 4X6 TFF", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/13 LB", casePriceUsd: 36.06, totalSpendUsd: 2164.94, flags: [] });
  });

  it("splits the pipe-delimited flags column", () => {
    const rows = parseAngelCatalog(`${HEADER}\nOVENGOLD TURKEY,,,Delmar Provisions,,,58.48,+0.8%,-0.0%,7913.31,,,,,,,NO_PACK_SIZE|BROKER_DIRECT`);
    expect(rows[0]!.flags).toEqual(["NO_PACK_SIZE", "BROKER_DIRECT"]);
  });

  it("returns null for a blank case price rather than 0", () => {
    // 0 would sail through a truthiness check and write a free ingredient.
    const rows = parseAngelCatalog(`${HEADER}\nX,,,PFG,,,,,,,,,,,,,`);
    expect(rows[0]!.casePriceUsd).toBeNull();
  });

  it("throws when an expected column is missing instead of silently reading junk", () => {
    expect(() => parseAngelCatalog("product,vendor\na,b")).toThrow(/expected column/);
  });
});
