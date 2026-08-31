/**
 * Unit spine — lib/angel-wave6.ts (the wave-6 full price fill).
 *
 * Same reason wave 1's tests exist: the failure this guards against is silent and
 * expensive. `vendor_price_history.unit_price` is the price of ONE OF OUR PACKS,
 * Angel quotes the price of ONE OF ITS CASES, and a dropped divisor does not throw —
 * it just makes Duke's Mayo cost 4× and every plate cost downstream inherits it.
 *
 * Wave 6 adds two things worth pinning beyond the arithmetic: the COUNT_AGREES
 * relation (a price with no weight basis at all, which must NOT be coerced into oz),
 * and the cross-wave integrity assertions that stop two divisors of record existing
 * for one pack.
 */
import { describe, it, expect } from "vitest";
import {
  WAVE6_FILL_RULES, WAVE6_REFUSALS, WAVE6_REASONS,
  resolveWave6, buildWave6SourceNote, packMatchesLive,
  wave1SkuOverlap, duplicateFillSkus, fillRefusalCollisions,
  type Wave6RefusalCode,
} from "@/lib/angel-wave6";
import { rowKey, type AngelCatalogRow } from "@/lib/angel-price-fill";

/** A catalog row matching a rule by index, so the join key is always right. */
function rowForRule(i: number, over: Partial<AngelCatalogRow> = {}): AngelCatalogRow {
  const r = WAVE6_FILL_RULES[i]!;
  return {
    product: r.product, brand: r.brand, vendor: r.vendor, packSizeRaw: r.packSizeRaw,
    casePriceUsd: 10, totalSpendUsd: 100, flags: [], ...over,
  };
}
function ruleByName(name: string) {
  const r = WAVE6_FILL_RULES.find((x) => x.skuName === name);
  if (!r) throw new Error(`no wave-6 rule for ${name}`);
  return r;
}
function rowFor(name: string, casePriceUsd: number): AngelCatalogRow {
  const r = ruleByName(name);
  return { product: r.product, brand: r.brand, vendor: r.vendor, packSizeRaw: r.packSizeRaw, casePriceUsd, totalSpendUsd: 0, flags: [] };
}

describe("table integrity — two divisors of record is not a state", () => {
  it("shares no SKU with wave 1's DIVISION_RULES", () => {
    expect(wave1SkuOverlap()).toEqual([]);
  });

  it("lists no SKU twice in the fill table", () => {
    expect(duplicateFillSkus()).toEqual([]);
  });

  it("never both fills and refuses the same SKU", () => {
    expect(fillRefusalCollisions()).toEqual([]);
  });

  it("gives every refusal a reason string", () => {
    for (const r of WAVE6_REFUSALS) {
      expect(WAVE6_REASONS[r.code], `${r.skuName} (${r.code})`).toBeTruthy();
    }
  });

  it("names at least one candidate on every refusal — a refusal is a finding, not a silence", () => {
    for (const r of WAVE6_REFUSALS) {
      expect(r.candidates.length, r.skuName).toBeGreaterThan(0);
      expect(r.note.length, r.skuName).toBeGreaterThan(0);
    }
  });

  it("keeps every rule's divisor consistent with its declared oz relation", () => {
    for (const r of WAVE6_FILL_RULES) {
      if (r.relation === "COUNT_AGREES") {
        // Count-space rules carry NO oz on either side — coercing one would invent
        // the denominator the relation exists to avoid.
        expect(r.ourPackOz, r.skuName).toBeNull();
        expect(r.angelCaseOz, r.skuName).toBeNull();
        expect(r.ourPackCount, r.skuName).toBe(r.angelCaseCount);
        expect(r.divisor, r.skuName).toBe(1);
        continue;
      }
      expect(r.ourPackOz, r.skuName).not.toBeNull();
      expect(r.angelCaseOz, r.skuName).not.toBeNull();
      if (r.relation === "PACK_AGREES") {
        expect(r.divisor, r.skuName).toBe(1);
        expect(r.ourPackOz, r.skuName).toBeCloseTo(r.angelCaseOz!, 2);
      } else {
        expect(r.divisor, r.skuName).toBeGreaterThan(1);
        // angelCaseOz / ourPackOz must land on the divisor (0.1% tolerance for the
        // litre constant on Olive Oil).
        expect(r.angelCaseOz! / r.ourPackOz!, r.skuName).toBeCloseTo(r.divisor, 1);
      }
    }
  });
});

describe("resolveWave6 — the divisor is the whole job", () => {
  it("divides the Duke's Mayo 4-gallon case by 4", () => {
    // $73.99 for 4 × 1 GA (512 oz); our pack is one gallon (128 oz). Writing the
    // case price straight through would overstate mayo 4×.
    const { fills } = resolveWave6([rowFor("Duke's Mayo", 73.99)]);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.unitPrice).toBe(18.5);
  });

  it("passes a PACK-AGREES case price through unchanged at divisor 1", () => {
    const { fills } = resolveWave6([rowFor("Canola Oil", 40.56)]);
    expect(fills[0]!.unitPrice).toBe(40.56);
  });

  it("rounds the Balsamic Vin half-cent tie UP and flags it as rounded", () => {
    // $34.51 / 2 = $17.255 exactly — a real half-cent tie in this wave's data, so
    // the tie rule is load-bearing rather than hypothetical.
    const { fills } = resolveWave6([rowFor("Balsamic Vin", 34.51)]);
    expect(fills[0]!.unitPrice).toBe(17.26);
    expect(fills[0]!.exact).toBe(17.255);
    expect(fills[0]!.rounded).toBe(true);
  });

  it("prices a COUNT_AGREES rule without any oz basis at all", () => {
    const { fills } = resolveWave6([rowFor("Cannoli Shell", 42.67)]);
    expect(fills[0]!.unitPrice).toBe(42.67);
    expect(fills[0]!.rule.ourPackOz).toBeNull();
  });

  it("reports a rule whose catalog row vanished — LOUDLY, never silently dropped", () => {
    const { fills, unmatchedRules } = resolveWave6([]);
    expect(fills).toEqual([]);
    expect(unmatchedRules).toHaveLength(WAVE6_FILL_RULES.length);
    expect(unmatchedRules[0]!.why).toMatch(/no catalog row/);
  });

  it("refuses a row whose case price went missing rather than emitting a nonsense price", () => {
    const { fills, unmatchedRules } = resolveWave6([rowFor("Canola Oil", 0)]);
    expect(fills).toEqual([]);
    // Target by name: the other rules are unmatched too (no row supplied for them),
    // so position in the list says nothing.
    const canola = unmatchedRules.find((u) => u.rule.skuName === "Canola Oil");
    expect(canola!.why).toMatch(/no usable case price/);
  });

  it("joins on the FULL key, so a same-named row with a different pack does not match", () => {
    const r = ruleByName("Canola Oil");
    const impostor: AngelCatalogRow = {
      product: r.product, brand: r.brand, vendor: r.vendor, packSizeRaw: "1/50 LB",
      casePriceUsd: 99.99, totalSpendUsd: 0, flags: [],
    };
    const { fills } = resolveWave6([impostor]);
    expect(fills).toEqual([]);
  });

  it("keeps rowKey stable between a rule and its catalog row", () => {
    const r = WAVE6_FILL_RULES[0]!;
    expect(rowKey(r)).toBe(rowKey(rowForRule(0)));
  });
});

describe("buildWave6SourceNote — a ledger row must be reconstructable alone", () => {
  it("shows the division and the unrounded quotient when rounding moved the number", () => {
    const { fills } = resolveWave6([rowFor("Balsamic Vin", 34.51)]);
    const note = buildWave6SourceNote(fills[0]!);
    expect(note).toContain("÷ 2");
    expect(note).toContain("exact 17.255");
    expect(note).toContain("$17.26");
  });

  it("says 'no division' for a PACK_AGREES row", () => {
    const { fills } = resolveWave6([rowFor("Canola Oil", 40.56)]);
    expect(buildWave6SourceNote(fills[0]!)).toContain("no division");
  });

  it("says count-space, and names no oz, for a COUNT_AGREES row", () => {
    const { fills } = resolveWave6([rowFor("Cannoli Shell", 42.67)]);
    const note = buildWave6SourceNote(fills[0]!);
    expect(note).toContain("count-space");
    expect(note).toContain("120 count");
    expect(note).not.toContain("oz");
  });

  it("names the Angel row's full identity, because product name alone is ambiguous", () => {
    const { fills } = resolveWave6([rowFor("Duke's Mayo", 73.99)]);
    const note = buildWave6SourceNote(fills[0]!);
    expect(note).toContain("MAYO HD");
    expect(note).toContain("DUKES");
    expect(note).toContain("4/1 GA");
  });
});

describe("packMatchesLive — the pack must not move under the divisor", () => {
  const canola = ruleByName("Canola Oil");
  const cannoli = ruleByName("Cannoli Shell");

  it("passes when the live content_oz matches the transcribed pack", () => {
    expect(packMatchesLive(canola, { contentOz: 560, unitsPerPack: 1 }).ok).toBe(true);
  });

  it("fails when the pack has drifted — the price would no longer mean what the note says", () => {
    const r = packMatchesLive(canola, { contentOz: 320, unitsPerPack: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/drift/);
  });

  it("fails honestly when the live SKU resolves to no content_oz", () => {
    const r = packMatchesLive(canola, { contentOz: null, unitsPerPack: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/no content_oz/);
  });

  it("tolerates the litre-constant artifact on Olive Oil (101.43 vs 101.44)", () => {
    expect(packMatchesLive(ruleByName("Olive Oil"), { contentOz: 101.44, unitsPerPack: 1 }).ok).toBe(true);
  });

  it("checks a COUNT_AGREES rule against units_per_pack, never oz", () => {
    // These SKUs legitimately have no oz basis; demanding one would fail exactly the
    // rows the count-space path exists to serve.
    expect(packMatchesLive(cannoli, { contentOz: null, unitsPerPack: 120 }).ok).toBe(true);
    const bad = packMatchesLive(cannoli, { contentOz: null, unitsPerPack: 200 });
    expect(bad.ok).toBe(false);
    expect(bad.why).toMatch(/units_per_pack 200/);
  });
});

describe("the refusal set encodes this wave's specific findings", () => {
  const byName = new Map(WAVE6_REFUSALS.map((r) => [r.skuName, r]));
  const codeOf = (n: string): Wave6RefusalCode => {
    const r = byName.get(n);
    if (!r) throw new Error(`expected a wave-6 refusal for ${n}`);
    return r.code;
  };

  it("refuses Chicken Breast on OUR OWN open pack shape, not on Angel's data", () => {
    // Seed 30 A-flagged the case-vs-bag question in writing and live now reads as
    // the case — the opposite of what seed 30 proposed. The two answers are 4× apart.
    expect(codeOf("Chicken Breast")).toBe("PACK_SHAPE_OPEN");
    expect(byName.get("Chicken Breast")!.presented).toMatch(/63\.58/);
    expect(byName.get("Chicken Breast")!.presented).toMatch(/15\.90/);
  });

  it("separates PACK_CONFLICT (two numbers disagree) from NO_OZ_BASIS (no second number)", () => {
    expect(codeOf("Panko (Japanese)")).toBe("PACK_CONFLICT");
    expect(codeOf("Roasted Red Peppers")).toBe("NO_OZ_BASIS");
  });

  it("keeps wave 1's standing refusals under their ORIGINAL codes", () => {
    // A refusal that has not changed must not be re-spelled; a second name for one
    // reason is exactly the drift this series avoids.
    expect(codeOf("Heavy Cream")).toBe("DUPLICATE_CLUSTER");
    expect(codeOf("Cheddar")).toBe("DUPLICATE_CLUSTER");
    expect(codeOf("Chives")).toBe("HIGH_PPL_REVIEW");
  });

  it("holds every 2024-sheet-only row under one code rather than writing it", () => {
    const sheetOnly = WAVE6_REFUSALS.filter((r) => r.code === "COSTING_SHEET_ONLY_2024");
    expect(sheetOnly.length).toBeGreaterThan(0);
    // Mortadella is the precedent row: wave 4 saw this exact number and declined.
    expect(codeOf("Mortadella")).toBe("COSTING_SHEET_ONLY_2024");
  });

  it("presents finished arithmetic wherever a pack exists to denominate against", () => {
    for (const r of WAVE6_REFUSALS) {
      if (r.code === "OUR_PACK_UNRESOLVABLE") continue; // nothing to denominate against
      expect(r.presented, r.skuName).toBeTruthy();
    }
  });
});
