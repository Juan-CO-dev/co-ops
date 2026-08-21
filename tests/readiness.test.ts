/**
 * Unit spine — lib/readiness.ts (the pure soft-gate rules).
 *
 * Focus: the DUPLICATE ACTIVE PRODUCERS warning added for multi-vendor audit P5
 * (2026-08-20), plus the closed-vocabulary invariant KNOWN_REASONS' own comment
 * asks for and nothing enforced until now — every reason code must have an
 * i18n key in BOTH en and es. Interpolated keys are grep-invisible, so a missing
 * one ships as a raw key rendered on an admin page.
 */
import { describe, it, expect } from "vitest";

import {
  KNOWN_REASONS,
  itemReadiness,
  composeRecipeReadiness,
  type Readiness,
  type ReasonCode,
} from "@/lib/readiness";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const BASE = {
  hasProducingRecipe: true,
  ozPerParUnit: 32,
  soldDirectly: false,
  sellPortionComplete: true,
};

describe("itemReadiness — duplicate active producers (audit P5)", () => {
  it("one producer on a complete item is READY (no badge, no noise)", () => {
    expect(itemReadiness({ ...BASE, activeProducerCount: 1 }, "ready")).toEqual({
      status: "ready",
      reasons: [],
    });
  });

  it("TWO active producers make an otherwise-clean item AMBER, with the count", () => {
    const r = itemReadiness({ ...BASE, activeProducerCount: 2 }, "ready");
    expect(r.status).toBe("upstream_gaps");
    expect(r.reasons).toEqual([{ code: "duplicate_producers", count: 2 }]);
  });

  it("rides ALONGSIDE a red row rather than being swallowed by it", () => {
    // Own fields missing AND ambiguous producers: red wins the badge, but the
    // ambiguity still has to be visible — it does not stop being true.
    const r = itemReadiness(
      { ...BASE, ozPerParUnit: null, activeProducerCount: 3 },
      "ready",
    );
    expect(r.status).toBe("incomplete");
    expect(r.reasons).toEqual([
      { code: "no_oz_per_par_unit" },
      { code: "duplicate_producers", count: 3 },
    ]);
  });

  it("stacks with an upstream recipe gap, duplicates first", () => {
    const r = itemReadiness({ ...BASE, activeProducerCount: 2 }, "incomplete");
    expect(r.status).toBe("upstream_gaps");
    expect(r.reasons).toEqual([
      { code: "duplicate_producers", count: 2 },
      { code: "upstream_recipe" },
    ]);
  });

  it("an ABSENT count warns about nothing (unknown is not a duplicate)", () => {
    expect(itemReadiness(BASE, "ready").status).toBe("ready");
    expect(itemReadiness({ ...BASE, activeProducerCount: 0 }, "ready").status).toBe("ready");
  });

  it("pre-existing behavior is untouched when there is at most one producer", () => {
    expect(itemReadiness({ ...BASE, hasProducingRecipe: false, activeProducerCount: 0 }, null))
      .toEqual({ status: "incomplete", reasons: [{ code: "no_recipe" }] });
    expect(itemReadiness({ ...BASE, activeProducerCount: 1 }, "upstream_gaps"))
      .toEqual({ status: "upstream_gaps", reasons: [{ code: "upstream_recipe" }] });
    expect(itemReadiness({ ...BASE, soldDirectly: true, sellPortionComplete: false, activeProducerCount: 1 }, "ready"))
      .toEqual({ status: "incomplete", reasons: [{ code: "sell_incomplete" }] });
  });
});

/**
 * RETIREMENT in the readiness lane (Juan's ruling A+, 2026-08-21; sim P1-9).
 *
 * Two codes, deliberately asymmetric:
 *   - retired_product = a RED own-fault. The pin refuses at the resolution ladder,
 *     so the recipe genuinely has no cost and no depletion.
 *   - retired_sku     = an amber RIDER that can never move a status. That is the
 *     ruling's scope line: for a deactivated SKU pin this PR buys LOUDNESS only.
 */
describe("composeRecipeReadiness — retirement pins", () => {
  const OWN_READY: Readiness = { status: "ready", reasons: [] };

  it("no pins at all → byte-identical to the pre-retirement behavior", () => {
    expect(composeRecipeReadiness(OWN_READY, [], [])).toEqual({ status: "ready", reasons: [] });
    expect(composeRecipeReadiness(OWN_READY, [], [], 0, {})).toEqual({ status: "ready", reasons: [] });
  });

  it("a RETIRED-PRODUCT pin makes an otherwise-clean recipe RED, with the count", () => {
    const r = composeRecipeReadiness(OWN_READY, [], [], 0, { retiredProducts: 2 });
    expect(r.status).toBe("incomplete");
    expect(r.reasons).toEqual([{ code: "retired_product", count: 2 }]);
  });

  it("retired_product and unresolved_product are counted SEPARATELY, never folded", () => {
    // Different errands: re-point this line vs fix the SKU catalog / weigh it.
    const r = composeRecipeReadiness(OWN_READY, [], [], 1, { retiredProducts: 1 });
    expect(r.status).toBe("incomplete");
    expect(r.reasons).toEqual([
      { code: "unresolved_product", count: 1 },
      { code: "retired_product", count: 1 },
    ]);
  });

  it("a retired-product pin rides ALONGSIDE the recipe's own red fields", () => {
    const own: Readiness = { status: "incomplete", reasons: [{ code: "no_batch_yield" }] };
    const r = composeRecipeReadiness(own, [], [], 0, { retiredProducts: 1 });
    expect(r.reasons).toEqual([
      { code: "no_batch_yield" },
      { code: "retired_product", count: 1 },
    ]);
  });

  it("RETIRED-SKU is a RIDER: it never changes a status, only names one", () => {
    // The realistic shape — an inactive SKU is absent from the readiness map, so
    // the same pin already contributes a not-ready status. Status stays amber; the
    // rider says WHY that SKU is not ready.
    const withRider = composeRecipeReadiness(OWN_READY, ["incomplete"], [], 0, { retiredSkus: 1 });
    const without = composeRecipeReadiness(OWN_READY, ["incomplete"], []);
    expect(withRider.status).toBe(without.status);
    expect(withRider.status).toBe("upstream_gaps");
    expect(withRider.reasons).toEqual([
      { code: "not_ready_skus", count: 1 },
      { code: "retired_sku", count: 1 },
    ]);
  });

  it("a retired-SKU rider can NEVER make a row RED — amber is its ceiling", () => {
    // The guard that keeps "loudness only" true: a deactivated SKU pin still
    // resolves (loadSkuPack includes inactive SKUs), so asserting a refusal would
    // be a lie. Even in the shape the live loader cannot produce — the count with
    // no matching not-ready SKU status — the worst it can do is amber.
    const r = composeRecipeReadiness(OWN_READY, [], [], 0, { retiredSkus: 3 });
    expect(r.status).toBe("upstream_gaps");
    expect(r.reasons).toEqual([{ code: "retired_sku", count: 3 }]);
  });

  it("both riders coexist: red product pin + amber SKU pin, red wins the badge", () => {
    const r = composeRecipeReadiness(OWN_READY, ["incomplete"], [], 0, {
      retiredProducts: 1,
      retiredSkus: 1,
    });
    expect(r.status).toBe("incomplete");
    expect(r.reasons).toEqual([
      { code: "retired_product", count: 1 },
      { code: "not_ready_skus", count: 1 },
      { code: "retired_sku", count: 1 },
    ]);
  });
});

describe("KNOWN_REASONS is a CLOSED vocabulary with full translation cover", () => {
  const enKeys = en as Record<string, string>;
  const esKeys = es as Record<string, string>;

  it.each(KNOWN_REASONS)("readiness.reason.%s exists in en and es", (code: ReasonCode) => {
    const key = `readiness.reason.${code}`;
    expect(enKeys[key], `missing en key ${key}`).toBeTruthy();
    expect(esKeys[key], `missing es key ${key}`).toBeTruthy();
  });

  it("has no ORPHAN reason keys (a key with no code behind it is dead copy)", () => {
    const declared = new Set<string>(KNOWN_REASONS.map((c) => `readiness.reason.${c}`));
    const live = Object.keys(enKeys).filter((k) => k.startsWith("readiness.reason."));
    expect(live.filter((k) => !declared.has(k))).toEqual([]);
  });
});
