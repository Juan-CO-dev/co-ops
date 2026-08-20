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

import { KNOWN_REASONS, itemReadiness, type ReasonCode } from "@/lib/readiness";
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
