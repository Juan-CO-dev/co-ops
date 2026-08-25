/**
 * Unit spine — lib/location-sku-shared.ts pure math (zero I/O, no server imports).
 * Covers overlay resolution for per-location par + active overrides (D1, migration 0174).
 *
 * Semantics (from spec §2.1 + lib/ordering.ts parForDay):
 *   resolvePar: resolve each field through the overlay (overlay.field ?? global.field),
 *   THEN apply the weekend-par day rule exactly as parForDay does:
 *     weekend && resolvedWeekendPar != null → resolvedWeekendPar, else resolvedWeekdayPar.
 *   resolveActive: overlayActive ?? globalActive.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePar,
  resolveParWithLane,
  resolveActive,
  walkDisposition,
  parReviewAdvisory,
  type WalkDispositionInput,
  type ParAdvisoryInput,
} from "../lib/location-sku-shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const global = (weekdayPar: number | null, weekendPar: number | null) => ({
  weekdayPar,
  weekendPar,
});

const overlay = (weekdayPar: number | null, weekendPar: number | null) => ({
  weekdayPar,
  weekendPar,
});

/**
 * The MACHINE lane (Dynamic Pars Phase 3, Task 3.3 — migration 0183).
 *
 * `auto*` fields are OPTIONAL on the overlay type on purpose: pre-0183-apply
 * `loadOverlayBySku` does not select them, so they are ABSENT (not null), and every
 * assertion in the four `resolvePar` blocks below — which pass two-field overlays —
 * is the pre-apply behaviour, unchanged. That is the zero-diff proof, in test form.
 */
const autoOverlay = (o: {
  weekdayPar?: number | null;
  weekendPar?: number | null;
  autoWeekdayPar?: number | null;
  autoWeekendPar?: number | null;
  autoWeekdayBaselinePar?: number | null;
  autoWeekendBaselinePar?: number | null;
}) => ({ weekdayPar: null, weekendPar: null, ...o });

// ── resolvePar: no overlay (null) — today's behavior byte-identical ───────────

describe("resolvePar — no overlay (null)", () => {
  it("weekday walk: returns global weekdayPar", () => {
    expect(resolvePar(null, global(3, 5), false)).toBe(3);
  });

  it("weekend walk + weekendPar set: returns global weekendPar", () => {
    expect(resolvePar(null, global(3, 5), true)).toBe(5);
  });

  it("weekend walk + weekendPar null: falls back to global weekdayPar (the weekday-fallback rule)", () => {
    // weekend=true but no weekendPar → weekdayPar is the applicable par
    expect(resolvePar(null, global(3, null), true)).toBe(3);
  });

  it("neither par set: returns null (SKU excluded from walk)", () => {
    expect(resolvePar(null, global(null, null), false)).toBeNull();
  });

  it("neither par set on a weekend walk: returns null", () => {
    expect(resolvePar(null, global(null, null), true)).toBeNull();
  });

  it("only weekendPar set, weekday walk: returns null (weekendPar does not apply on weekdays)", () => {
    // weekend=false, weekendPar=5, weekdayPar=null → parForDay returns weekdayPar=null
    expect(resolvePar(null, global(null, 5), false)).toBeNull();
  });
});

// ── resolvePar: overlay overrides one field only ──────────────────────────────

describe("resolvePar — overlay overrides weekdayPar only", () => {
  it("weekday walk: overlay weekdayPar wins over global weekdayPar", () => {
    // overlay.weekdayPar = 7, global.weekdayPar = 3 → 7
    expect(resolvePar(overlay(7, null), global(3, 5), false)).toBe(7);
  });

  it("weekend walk: overlay weekdayPar does not affect weekendPar selection", () => {
    // weekend walk: resolved weekendPar = global.weekendPar = 5 (overlay has null)
    // weekend=true && resolvedWeekendPar(5) != null → 5
    expect(resolvePar(overlay(7, null), global(3, 5), true)).toBe(5);
  });

  it("weekend walk + overlay weekdayPar only, global weekendPar null: falls back to overlay weekdayPar", () => {
    // resolvedWeekendPar = null (both overlay and global null) → fall back to resolvedWeekdayPar = 7
    expect(resolvePar(overlay(7, null), global(3, null), true)).toBe(7);
  });
});

describe("resolvePar — overlay overrides weekendPar only", () => {
  it("weekend walk: overlay weekendPar wins over global weekendPar", () => {
    // overlay.weekendPar = 10, global.weekendPar = 5 → 10
    expect(resolvePar(overlay(null, 10), global(3, 5), true)).toBe(10);
  });

  it("weekday walk: overlay weekendPar has no effect (weekday rule applies)", () => {
    // weekday walk → resolvedWeekdayPar = global.weekdayPar = 3 (overlay.weekdayPar null)
    expect(resolvePar(overlay(null, 10), global(3, 5), false)).toBe(3);
  });

  it("weekday walk, global weekdayPar null, overlay weekdayPar null: returns null", () => {
    expect(resolvePar(overlay(null, 10), global(null, 5), false)).toBeNull();
  });
});

// ── resolvePar: overlay overrides both fields ─────────────────────────────────

describe("resolvePar — overlay overrides both fields", () => {
  it("weekday walk: overlay weekdayPar wins", () => {
    expect(resolvePar(overlay(8, 12), global(3, 5), false)).toBe(8);
  });

  it("weekend walk: overlay weekendPar wins", () => {
    expect(resolvePar(overlay(8, 12), global(3, 5), true)).toBe(12);
  });
});

// ── resolvePar: overlay weekend override with global weekday fallback ─────────

describe("resolvePar — overlay weekend par + global weekday fallback", () => {
  it("overlay sets weekendPar, no weekdayPar anywhere: weekend walk returns overlay weekendPar", () => {
    // resolvedWeekendPar = 9 (overlay), resolvedWeekdayPar = null (both null)
    expect(resolvePar(overlay(null, 9), global(null, null), true)).toBe(9);
  });

  it("overlay sets weekendPar; weekend walk returns overlay weekendPar, not global weekdayPar", () => {
    // resolvedWeekendPar = 9, resolvedWeekdayPar = 3 (global); weekend → 9
    expect(resolvePar(overlay(null, 9), global(3, null), true)).toBe(9);
  });

  it("overlay sets weekendPar; weekday walk falls back to resolvedWeekdayPar (global)", () => {
    // weekday walk → resolvedWeekdayPar = 3 (from global, overlay.weekdayPar=null)
    expect(resolvePar(overlay(null, 9), global(3, null), false)).toBe(3);
  });
});

// ── resolvePar: null-par result when neither layer has the day's value ─────────

describe("resolvePar — null-par result", () => {
  it("overlay weekdayPar null, global weekdayPar null, weekday walk → null", () => {
    expect(resolvePar(overlay(null, 5), global(null, null), false)).toBeNull();
  });

  it("overlay weekendPar null, global weekendPar null, weekend walk → falls back to resolvedWeekdayPar", () => {
    // resolvedWeekendPar = null → fall back to resolvedWeekdayPar = 4
    expect(resolvePar(overlay(null, null), global(4, null), true)).toBe(4);
  });

  it("all four par slots null, any walk day → null (SKU excluded from walk)", () => {
    expect(resolvePar(overlay(null, null), global(null, null), false)).toBeNull();
    expect(resolvePar(overlay(null, null), global(null, null), true)).toBeNull();
  });
});

// ── THE THIRD LANE: human ?? auto ?? global (Task 3.3, migration 0183) ────────

describe("resolvePar — three lanes (human ?? auto ?? global)", () => {
  it("DAY ONE: no overlay at all is byte-identical to the two-layer form", () => {
    // The whole pre-apply contract in one assertion: `null ?? global` = global.
    expect(resolvePar(null, global(3, 5), false)).toBe(3);
    expect(resolveParWithLane(null, global(3, 5), false)).toEqual({ par: 3, lane: "global" });
    expect(resolveParWithLane(null, global(null, null), false)).toEqual({ par: null, lane: "none" });
  });

  it("PRE-APPLY: an overlay with the auto fields ABSENT resolves exactly as today", () => {
    // This is the shape loadOverlayBySku hands back while the 0183 probe is false.
    expect(resolvePar(overlay(7, null), global(3, 5), false)).toBe(7);
    expect(resolvePar(overlay(7, null), global(3, 5), true)).toBe(5);
    expect(resolveParWithLane(overlay(null, null), global(3, 5), true)).toEqual({
      par: 5, lane: "global",
    });
  });

  it("the HUMAN lane always wins over the machine's, per field", () => {
    const o = autoOverlay({ weekdayPar: 7, autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 });
    expect(resolveParWithLane(o, global(3, null), false)).toEqual({ par: 7, lane: "human" });
  });

  it("the AUTO lane beats the global when the human lane is empty", () => {
    const o = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 });
    expect(resolveParWithLane(o, global(3, null), false)).toEqual({ par: 4, lane: "auto" });
  });

  it("SELF-INVALIDATION: a baseline that no longer matches the global is IGNORED", () => {
    // r2-6: a human edited the global par from 3 to 6. The machine's 4 was an opinion
    // about a baseline that no longer exists, so the human's global edit reasserts itself.
    const o = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 });
    expect(resolveParWithLane(o, global(6, null), false)).toEqual({ par: 6, lane: "global" });
  });

  it("SELF-INVALIDATION: the caller can SEE the auto value was ignored", () => {
    const stale = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 });
    const live = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 6 });
    expect(resolveParWithLane(stale, global(6, null), false).lane).toBe("global");
    expect(resolveParWithLane(live, global(6, null), false).lane).toBe("auto");
  });

  it("a MISSING baseline never validates an auto value against a non-null global", () => {
    // Baseline null + global 3 must NOT match: an auto value with no recorded baseline
    // cannot prove what it was computed against, and an unprovable claim loses.
    const o = autoOverlay({ autoWeekdayPar: 4 });
    expect(resolveParWithLane(o, global(3, null), false)).toEqual({ par: 3, lane: "global" });
  });

  it("baseline null DOES match a null global — the honest 'computed against no global'", () => {
    const o = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: null });
    expect(resolveParWithLane(o, global(null, null), false)).toEqual({ par: 4, lane: "auto" });
  });

  it("the WEEKEND day rule is applied AFTER the three-lane resolution", () => {
    // Weekend slot: human absent, auto valid → the weekend auto governs a weekend walk,
    // and the weekday lanes govern a weekday walk. Byte-identical placement to parForDay.
    const o = autoOverlay({
      autoWeekdayPar: 4, autoWeekdayBaselinePar: 3,
      autoWeekendPar: 9, autoWeekendBaselinePar: 8,
    });
    expect(resolveParWithLane(o, global(3, 8), true)).toEqual({ par: 9, lane: "auto" });
    expect(resolveParWithLane(o, global(3, 8), false)).toEqual({ par: 4, lane: "auto" });
  });

  it("a weekend walk with NO weekend value anywhere falls to the weekday lane", () => {
    // 121 of 141 par'd SKUs have no weekend slot — this is the majority path.
    const o = autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 });
    expect(resolveParWithLane(o, global(3, null), true)).toEqual({ par: 4, lane: "auto" });
  });

  it("an auto value on a slot the HUMAN has filled is never consulted", () => {
    const o = autoOverlay({
      weekendPar: 12, autoWeekendPar: 9, autoWeekendBaselinePar: 8,
      autoWeekdayPar: 4, autoWeekdayBaselinePar: 3,
    });
    expect(resolveParWithLane(o, global(3, 8), true)).toEqual({ par: 12, lane: "human" });
  });

  it("resolvePar is exactly resolveParWithLane().par for every shape", () => {
    const shapes = [
      autoOverlay({}),
      autoOverlay({ weekdayPar: 7 }),
      autoOverlay({ autoWeekdayPar: 4, autoWeekdayBaselinePar: 3 }),
      autoOverlay({ autoWeekendPar: 9, autoWeekendBaselinePar: 8 }),
    ];
    for (const o of shapes) {
      for (const weekend of [false, true]) {
        expect(resolvePar(o, global(3, 8), weekend)).toBe(
          resolveParWithLane(o, global(3, 8), weekend).par,
        );
      }
    }
  });
});

// ── resolveActive ──────────────────────────────────────────────────────────────

describe("resolveActive — no overlay (null/undefined)", () => {
  it("null overlayActive: inherits globalActive = true", () => {
    expect(resolveActive(null, true)).toBe(true);
  });

  it("null overlayActive: inherits globalActive = false", () => {
    expect(resolveActive(null, false)).toBe(false);
  });

  it("undefined overlayActive: inherits globalActive = true", () => {
    expect(resolveActive(undefined, true)).toBe(true);
  });

  it("undefined overlayActive: inherits globalActive = false", () => {
    expect(resolveActive(undefined, false)).toBe(false);
  });
});

describe("resolveActive — explicit deactivation (overlay false)", () => {
  it("false deactivates even when globalActive = true", () => {
    expect(resolveActive(false, true)).toBe(false);
  });

  it("false deactivates when globalActive = false", () => {
    expect(resolveActive(false, false)).toBe(false);
  });
});

describe("resolveActive — promotional true-override", () => {
  it("true activates even when globalActive = false (promotional / location-specific)", () => {
    expect(resolveActive(true, false)).toBe(true);
  });

  it("true with globalActive = true: stays true", () => {
    expect(resolveActive(true, true)).toBe(true);
  });
});

/**
 * THE WALK CAUSE LADDER — first-cause-wins (`walkDisposition`).
 *
 * Extracted pure when Juan's retirement ruling (2026-08-21) added a FIFTH outcome and
 * a new top rung: `loadWalkerData` is DB-coupled and stays off this spine, so the
 * ORDER — the part that is easy to get wrong and that the ruling changed — lives here.
 *
 * The ruling: *"discontinuation is about stopping the SKU from being ordered etc…
 * pars should be affected if less demand for that SKU is happening."* Pars are
 * downstream of demand, so a retired product's pars are stale by definition.
 */
describe("walkDisposition — the par pass's cause ladder", () => {
  const OK: WalkDispositionInput = {
    productRetired: false, vendorKnown: true, skuActive: true, par: 4,
  };

  it("a healthy par'd SKU WALKS", () => {
    expect(walkDisposition(OK)).toBe("walk");
  });

  it("the four exclusions each classify on their own", () => {
    expect(walkDisposition({ ...OK, productRetired: true })).toBe("productRetired");
    expect(walkDisposition({ ...OK, vendorKnown: false })).toBe("vendorInactive");
    expect(walkDisposition({ ...OK, skuActive: false })).toBe("skuInactive");
    expect(walkDisposition({ ...OK, par: null })).toBe("parNull");
  });

  it("RETIREMENT OUTRANKS EVERY SKU-LEVEL CAUSE — the ruling's whole point", () => {
    // Reporting "turn the vendor back on" for a product Juan discontinued sends him
    // on an errand he already decided against. The product-level fact wins.
    expect(walkDisposition({
      productRetired: true, vendorKnown: false, skuActive: false, par: null,
    })).toBe("productRetired");
    expect(walkDisposition({ ...OK, productRetired: true, vendorKnown: false })).toBe("productRetired");
    expect(walkDisposition({ ...OK, productRetired: true, skuActive: false })).toBe("productRetired");
    expect(walkDisposition({ ...OK, productRetired: true, par: null })).toBe("productRetired");
  });

  it("a retired product suppresses the row EVEN WITH a live par — suppressed, not deleted", () => {
    // The par value is untouched and still present in the input; the walk simply
    // stops acting on it. That is what makes a restore exact — see the restore test.
    const r = walkDisposition({ ...OK, productRetired: true, par: 12 });
    expect(r).toBe("productRetired");
  });

  it("RESTORE IS EXACT: flipping the product back reproduces the prior disposition", () => {
    // The reversibility contract. Retirement is a read-time gate over untouched par
    // columns, so un-retiring restores the identical walk for every input shape —
    // there is no par to re-enter because none was ever cleared.
    const shapes: WalkDispositionInput[] = [
      { ...OK },
      { ...OK, par: 12 },
      { ...OK, vendorKnown: false },
      { ...OK, skuActive: false },
      { ...OK, par: null },
      { productRetired: false, vendorKnown: false, skuActive: false, par: null },
    ];
    for (const shape of shapes) {
      const before = walkDisposition(shape);
      const retired = walkDisposition({ ...shape, productRetired: true });
      const restored = walkDisposition({ ...shape, productRetired: false });
      expect(retired).toBe("productRetired");
      expect(restored).toBe(before);
    }
  });

  it("the pre-retirement ladder is byte-identical when no product is retired", () => {
    // ①–③ are unchanged: any SKU whose product is not retired classifies exactly as
    // it did before the ruling. This is the regression guard on the refactor that
    // moved the order out of loadWalkerData's if-chain and into this function.
    expect(walkDisposition({ ...OK, vendorKnown: false, skuActive: false })).toBe("vendorInactive");
    expect(walkDisposition({ ...OK, vendorKnown: false, par: null })).toBe("vendorInactive");
    expect(walkDisposition({ ...OK, skuActive: false, par: null })).toBe("skuInactive");
  });

  it("par 0 is a REAL par, not an absent one — only null excludes", () => {
    expect(walkDisposition({ ...OK, par: 0 })).toBe("walk");
  });
});

/**
 * PAR-REVIEW ADVISORIES — cause-attributed, never numeric (Juan, 2026-08-21:
 * "the pars should be loud about why they need to be tuned down when demand lessens
 * because of retirement. The system recognizes what's going on before the human does.")
 *
 * The load-bearing test in here is the INVENTORY-ONLY carve-out and the
 * no-event-no-advisory rule. Both come straight off a live check run before the rule
 * was written: 57 of 141 par'd SKUs are inventory-only with zero recipe refs, and 20
 * more are non-inventory with zero refs of which 16 are RESALE goods (Coke, Saratoga,
 * Frooties…) that correctly have no recipe. Firing on the static state would have
 * cried wolf on ~73 rows on day one.
 */
describe("parReviewAdvisory — cause-attributed par nudges", () => {
  const BASE: ParAdvisoryInput = {
    inventoryOnly: false, productRetired: false, activeRecipeRefs: 2, removedSources: [],
  };

  it("says NOTHING when nothing changed — a healthy par is silent", () => {
    expect(parReviewAdvisory(BASE)).toBeNull();
  });

  it("A STATE IS NOT A TRIGGER: zero active refs alone raises nothing", () => {
    // This is the resale case — Coke has no recipe and never had one. Only a CHANGE
    // (a removed source) speaks, because only a change is news.
    expect(parReviewAdvisory({ ...BASE, activeRecipeRefs: 0 })).toBeNull();
  });

  it("INVENTORY-ONLY is never advised, even with a removed source", () => {
    // A par on to-go cups was never recipe-derived; "no recipe uses this" is a
    // category error on it. This rung outranks every other, including retirement.
    expect(parReviewAdvisory({
      ...BASE, inventoryOnly: true, activeRecipeRefs: 0, removedSources: ["Ham Sub"],
    })).toBeNull();
    expect(parReviewAdvisory({
      ...BASE, inventoryOnly: true, productRetired: true,
    })).toBeNull();
  });

  it("a removed source with others remaining → demand_source_removed, recipe NAMED", () => {
    const r = parReviewAdvisory({ ...BASE, activeRecipeRefs: 1, removedSources: ["Ham Sub"] });
    expect(r).toEqual({
      code: "demand_source_removed", removedSources: ["Ham Sub"], activeRecipeRefs: 1,
    });
  });

  it("a removed source with NOTHING left → no_demand_source, the stronger form", () => {
    const r = parReviewAdvisory({ ...BASE, activeRecipeRefs: 0, removedSources: ["Ham Sub"] });
    expect(r?.code).toBe("no_demand_source");
    expect(r?.removedSources).toEqual(["Ham Sub"]);
  });

  it("a retired PRODUCT outranks the removal codes", () => {
    const r = parReviewAdvisory({
      ...BASE, productRetired: true, activeRecipeRefs: 0, removedSources: ["Ham Sub"],
    });
    expect(r?.code).toBe("product_retired");
  });

  it("NEVER invents a number — the advisory carries causes, not a suggested par", () => {
    // Dynamic Pars owns numeric suggestion; this rule must stay descriptive. If a
    // `suggestedPar`-shaped field ever appears here, that scope line has been crossed.
    const r = parReviewAdvisory({ ...BASE, activeRecipeRefs: 0, removedSources: ["A", "B"] });
    expect(Object.keys(r ?? {}).sort()).toEqual(["activeRecipeRefs", "code", "removedSources"]);
  });

  it("reports EVERY removed source, and does not mutate its input", () => {
    const removedSources = ["Zeta Sub", "Alpha Sub"];
    const r = parReviewAdvisory({ ...BASE, activeRecipeRefs: 0, removedSources });
    expect(r?.removedSources).toEqual(["Zeta Sub", "Alpha Sub"]);
    r?.removedSources.push("mutated");
    expect(removedSources).toEqual(["Zeta Sub", "Alpha Sub"]);
  });
});
