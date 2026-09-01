/**
 * Unit spine — the WALKER's read-time half of Dynamic Pars (plan Phase 4, Tasks 4.1 + 4.6).
 *
 * Two pure rules live here and nothing else:
 *   · `resolveWalkerSuggestion` — head ruling R3-A. The nightly persists the DEMAND TERMS;
 *     the walk re-selects only the HORIZON and re-runs the two trivial halves over them.
 *     The 9:58 and the 10:02 walk must render different, both-correct numbers from ONE row.
 *   · `rollupParSilence` — the reason lane's aggregate. The flagship deliverable: every
 *     silent par lands in a NAMED cause bucket, errands first. A bucket that reads "other"
 *     is a bug, so the closure is asserted over the whole vocabulary.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import {
  EMPTY_PAR_SILENCE,
  ERRAND_REASONS,
  PAR_REASON_CODES,
  SILENCE_SAMPLE_CAP,
  SILENCING_REASONS,
  resolveWalkerSuggestion,
  rollupParSilence,
  type ParReasonCode,
  type PersistedDemandTerms,
  type SilenceLedgerRow,
  type WalkerSuggestionInput,
} from "../lib/dynamic-pars-shared";

const LOC = "loc-1";
const SKU = "sku-1";

/** A SKU whose lanes are lit: 40 oz/day weekday, 60 weekend, 16 oz per order unit. */
function terms(over: Partial<PersistedDemandTerms> = {}): PersistedDemandTerms {
  return {
    currentPar: 10,
    parStep: 1,
    baseOzPerDay: { weekday: 40, weekend: 60 },
    velocityRatio: 1,
    velocityApplied: false,
    cushionPct: 0.2,
    perOrderUnitOz: 16,
    peakFloorOz: null,
    priorSuggestedPar: null,
    priorDirection: 0,
    reasonCode: "ok",
    ledgerTier: "suggestion",
    suppressedBy: null,
    ...over,
  };
}

function input(over: Partial<WalkerSuggestionInput> = {}): WalkerSuggestionInput {
  return {
    locationId: LOC,
    skuId: SKU,
    dayClass: "weekday",
    terms: terms(),
    // 2026-08-25 is a Tuesday; Wed + Thu are both weekdays at the shipped boundary.
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    canAct: true,
    ...over,
  };
}

describe("resolveWalkerSuggestion — R3-A, the horizon re-selected live", () => {
  it("renders the number pair from the persisted terms over the live horizon", () => {
    // 2 covered weekdays x 40 oz = 80 oz, +20% cushion = 96 oz, / 16 = 6 units.
    const s = resolveWalkerSuggestion(input());
    expect(s).not.toBeNull();
    expect(s!.currentPar).toBe(10);
    expect(s!.suggestedPar).toBe(6);
    expect(s!.coveredDayCount).toBe(2);
    expect(s!.coverThroughDate).toBe("2026-08-28");
    expect(s!.cushionPct).toBe(0.2);
  });

  it("THE 9:58 / 10:02 PAIR: one ledger row, two horizons, two honest numbers", () => {
    // Before the cutoff the order catches today's truck and the par must cover 2 days;
    // after it, the same walk is ordering against a later truck and must cover 4.
    const before = resolveWalkerSuggestion(input({ coveredDays: ["2026-08-26", "2026-08-27"] }));
    const after = resolveWalkerSuggestion(
      input({ coveredDays: ["2026-08-26", "2026-08-27", "2026-08-31", "2026-09-01"] }),
    );
    expect(before!.suggestedPar).toBe(6);
    expect(after!.suggestedPar).toBe(12);
    // The identity moves with the number — that is what the 409 arbitrates on.
    expect(before!.generationId).not.toBe(after!.generationId);
    expect(after!.generationId).toBe(`${LOC}:${SKU}:weekday:10>12`);
  });

  it("sums PER COVERED DAY across a day-class boundary, never rate x days", () => {
    // Fri/Sat are weekend at the shipped boundary (60 oz), Thu is a weekday (40 oz).
    const s = resolveWalkerSuggestion(
      input({ coveredDays: ["2026-08-27", "2026-08-28", "2026-08-29"] }),
    );
    // 40 + 60 + 60 = 160 oz, +20% = 192, / 16 = 12.
    expect(s!.suggestedPar).toBe(12);
  });

  it("carries the peak floor through and flags it", () => {
    // Mean+cushion says 96 oz; the observed peak over this horizon says 176. A percentage
    // on a mean is not a service level (the Prosciutto proof) — the floor wins: 176/16 = 11.
    const s = resolveWalkerSuggestion(input({ terms: terms({ peakFloorOz: 176 }) }));
    expect(s!.flooredByPeak).toBe(true);
    expect(s!.suggestedPar).toBe(11);
    // …and a floor the mean already clears changes nothing but the flag.
    const unfloored = resolveWalkerSuggestion(input({ terms: terms({ peakFloorOz: 20 }) }));
    expect(unfloored!.flooredByPeak).toBe(false);
    expect(unfloored!.suggestedPar).toBe(6);
  });

  it("is HONEST-NULL for every silencing reason the nightly ladder already reached", () => {
    for (const code of SILENCING_REASONS) {
      expect(resolveWalkerSuggestion(input({ terms: terms({ reasonCode: code }) }))).toBeNull();
    }
  });

  it("is honest-null when a coverage term is missing rather than guessing one", () => {
    expect(resolveWalkerSuggestion(input({ terms: terms({ cushionPct: null }) }))).toBeNull();
    expect(resolveWalkerSuggestion(input({ terms: terms({ perOrderUnitOz: null }) }))).toBeNull();
    // F5's zero case: a 0-oz order unit is not a denominator, and it is not null either.
    expect(resolveWalkerSuggestion(input({ terms: terms({ perOrderUnitOz: 0 }) }))).toBeNull();
    expect(resolveWalkerSuggestion(input({ coveredDays: [] }))).toBeNull();
  });

  it("never renders a number for a slot that does not exist (D16)", () => {
    expect(resolveWalkerSuggestion(input({ terms: terms({ currentPar: null }) }))).toBeNull();
  });

  it("declines when the live horizon has a day-class with no rate", () => {
    const t = terms({ baseOzPerDay: { weekday: 40, weekend: null } });
    expect(resolveWalkerSuggestion(input({ terms: t, coveredDays: ["2026-08-28"] }))).toBeNull();
  });

  it("renders nothing when the live horizon produces no movement worth showing", () => {
    // 4 weekdays x 40 = 160 oz, +20% = 192, /16 = 12 ... but at par 10 that is beyond the
    // band, so it renders as a SUGGESTION. Shrink the horizon so the target IS the par.
    const s = resolveWalkerSuggestion(
      input({ terms: terms({ currentPar: 6 }), coveredDays: ["2026-08-26", "2026-08-27"] }),
    );
    expect(s).toBeNull();
  });

  it("labels a par below the band's resolution as manual-only, at the honest number", () => {
    // par 3 with step 1 is 3 steps — below MIN_STEPS_FOR_AUTO (4).
    const s = resolveWalkerSuggestion(input({ terms: terms({ currentPar: 3 }) }));
    expect(s!.reasonCode).toBe("below_band_resolution");
    expect(s!.tier).toBe("suggestion");
    expect(s!.suggestedPar).toBe(6);
  });

  it("quarantines a unit-suspect target as a reason row, never a number", () => {
    // par 2 vs a target of 6 is 3x — the Fresh-Mozz eaches-vs-cases bomb.
    expect(resolveWalkerSuggestion(input({ terms: terms({ currentPar: 2 }) }))).toBeNull();
  });

  it("uses the run's OWN hysteresis prior, not its rendered suggestion (R3-A)", () => {
    // A prior of 6 within one step of the candidate 6 keeps 6; a prior two steps away
    // does not damp it. If we fed the nightly's own suggestion in here instead, the live
    // horizon could never move the number by one step and R3-A would be dead.
    const damped = resolveWalkerSuggestion(input({ terms: terms({ priorSuggestedPar: 7 }) }));
    expect(damped!.suggestedPar).toBe(7);
    const free = resolveWalkerSuggestion(input({ terms: terms({ priorSuggestedPar: 9 }) }));
    expect(free!.suggestedPar).toBe(6);
  });

  it("THE TIER IS NEVER RICHER THAN THE LEDGER'S", () => {
    // A confirmed, in-band, unguarded move: the guard stack says auto.
    const autoTerms = terms({
      currentPar: 7, priorSuggestedPar: 6, priorDirection: -1, ledgerTier: "auto",
    });
    const auto = resolveWalkerSuggestion(input({ terms: autoTerms }));
    expect(auto!.tier).toBe("auto");
    // Same verdict, but last night the engine only reached "suggestion": clamp to it.
    const clamped = resolveWalkerSuggestion(
      input({ terms: { ...autoTerms, ledgerTier: "suggestion" } }),
    );
    expect(clamped!.suggestedPar).toBe(auto!.suggestedPar);
    expect(clamped!.tier).toBe("suggestion");
  });

  it("reconstructs the pin and the budget from the guard that actually fired", () => {
    const base = terms({ currentPar: 7, priorSuggestedPar: 6, priorDirection: -1, ledgerTier: "auto" });
    expect(resolveWalkerSuggestion(input({ terms: { ...base, suppressedBy: "pin" } }))!.reasonCode)
      .toBe("pinned");
    expect(resolveWalkerSuggestion(input({ terms: { ...base, suppressedBy: "budget" } }))!.reasonCode)
      .toBe("budget_spent");
  });

  it("passes canAct through untouched — the client never re-decides authority", () => {
    expect(resolveWalkerSuggestion(input({ canAct: false }))!.canAct).toBe(false);
    expect(resolveWalkerSuggestion(input({ canAct: true }))!.canAct).toBe(true);
  });

  it("carries velocityApplied through as a display fact, never as an oz term", () => {
    const s = resolveWalkerSuggestion(input({ terms: terms({ velocityApplied: true, velocityRatio: 1.25 }) }));
    expect(s!.velocityApplied).toBe(true);
    // 80 oz x 1.25 = 100, +20% = 120, /16 = 7.5 → 8 at step 1.
    expect(s!.suggestedPar).toBe(8);
  });
});

describe("rollupParSilence — the errand list", () => {
  const row = (reasonCode: ParReasonCode, skuName: string | null, skuId = "s"): SilenceLedgerRow => ({
    skuId, reasonCode, skuName,
  });
  const extras = {
    suggestionsWaiting: 2, autoMovesThisWeek: 3, runDate: "2026-08-25", shadowMode: true,
  };

  it("counts speaking rows and never lists them as a cause", () => {
    const s = rollupParSilence([row("ok", "A"), row("ok", "B"), row("thin_history", "C")], extras);
    expect(s.speaking).toBe(2);
    expect(s.byCause.map((c) => c.cause)).toEqual(["thin_history"]);
  });

  it("orders ERRANDS first, then faults, then the not-a-fault causes LAST", () => {
    // 114 of CO's silent rows are packaging. A plain vocabulary order puts inventory_only
    // above every real errand and buries the list the panel exists for (Task 4.6).
    const s = rollupParSilence(
      [
        row("inventory_only", "Napkins"),
        row("product_retired", "Old sub"),
        row("thin_history", "Oregano"),
        row("no_vendor_rhythm", "Baldor thing"),
        row("no_weight_basis", "Mozz"),
      ],
      extras,
    );
    expect(s.byCause.map((c) => c.cause)).toEqual([
      "no_weight_basis", "no_vendor_rhythm", "thin_history", "inventory_only", "product_retired",
    ]);
    for (const errand of ["no_weight_basis", "no_vendor_rhythm"] as const) {
      expect(ERRAND_REASONS).toContain(errand);
    }
  });

  it("caps the named sample at three and still counts the rest", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n) => row("no_weight_basis", n));
    const s = rollupParSilence(rows, extras);
    expect(s.byCause[0]!.count).toBe(5);
    expect(s.byCause[0]!.sampleSkuNames).toEqual(["A", "B", "C"]);
    expect(s.byCause[0]!.sampleSkuNames.length).toBe(SILENCE_SAMPLE_CAP);
  });

  it("NEVER swallows a cause — every non-ok reason code gets its own bucket", () => {
    const rows = PAR_REASON_CODES.filter((c) => c !== "ok").map((c) => row(c, c));
    const s = rollupParSilence(rows, extras);
    expect(s.byCause.length).toBe(PAR_REASON_CODES.length - 1);
    expect(new Set(s.byCause.map((c) => c.cause))).toEqual(
      new Set(PAR_REASON_CODES.filter((c) => c !== "ok")),
    );
  });

  it("keeps the per-row badge dark while silence is the majority, and flips itself", () => {
    const silent = [row("thin_history", "A"), row("thin_history", "B"), row("thin_history", "C")];
    expect(rollupParSilence([...silent, row("ok", "D")], extras).badgePerRow).toBe(false);
    expect(rollupParSilence([row("thin_history", "A"), row("ok", "B"), row("ok", "C")], extras)
      .badgePerRow).toBe(true);
  });

  it("passes the run's own facts through, and the empty summary claims nothing", () => {
    const s = rollupParSilence([], extras);
    expect(s.suggestionsWaiting).toBe(2);
    expect(s.autoMovesThisWeek).toBe(3);
    expect(s.runDate).toBe("2026-08-25");
    expect(s.shadowMode).toBe(true);
    expect(EMPTY_PAR_SILENCE.runDate).toBeNull();
    expect(EMPTY_PAR_SILENCE.byCause).toEqual([]);
    expect(EMPTY_PAR_SILENCE.badgePerRow).toBe(false);
    // No run means nothing is watching, so the banner must not claim otherwise.
    expect(EMPTY_PAR_SILENCE.shadowMode).toBe(false);
  });

  it("tolerates a missing SKU name rather than inventing one", () => {
    const s = rollupParSilence([row("no_weight_basis", null), row("no_weight_basis", "B")], extras);
    expect(s.byCause[0]!.count).toBe(2);
    expect(s.byCause[0]!.sampleSkuNames).toEqual(["B"]);
  });
});

// ── THE TWO STRUCTURAL RULES IN loadWalkerData (Task 4.2) ────────────────────
//
// Both are properties of the WALK ORDER inside one DB-coupled function, so no unit test
// over its exports can see them. Reading the source is the only assertion available —
// the same posture Task 4.7's grep takes, and the reason it takes it: when the guarantee
// is "this never happens", the absence is what has to be asserted.

describe("loadWalkerData's row rules, at the source", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "ordering.ts"),
    "utf8",
  );

  it("THE EXCLUSIVITY is enforced in the ONE row builder, not per call site", () => {
    // r1: the #283 cause advisory and the numeric suggestion never render on one row, and
    // when both exist the NUMBER wins. Enforced in `buildRow`, which the par'd walk AND
    // the rerouted-backup path both go through — so a rescued row cannot dodge it.
    expect(src.includes("parAdvisory: parSuggestion != null ? null : parAdvisory")).toBe(true);
  });

  it("RETIREMENT SUPPRESSION still wins: a retired product never reaches a row", () => {
    // Spec, "What it never does": the arc never overrides the retirement suppression.
    // The gate `continue`s before any row is built, so a retired product's SKU can never
    // carry a suggestion — structurally, not by a check inside the suggestion path.
    const loopAt = src.indexOf("for (const s of skus) {");
    const retiredAt = src.indexOf('if (disposition === "productRetired")', loopAt);
    const buildAt = src.indexOf("const row = buildRow(s, par, parIsWeekend, null);", loopAt);
    expect(loopAt).toBeGreaterThan(-1);
    expect(retiredAt).toBeGreaterThan(loopAt);
    expect(buildAt).toBeGreaterThan(retiredAt);
  });

  it("the parReview counter reads the FINAL rows, so the exclusivity is reflected in it", () => {
    // Counting inside buildRow would report advisories the product dedupe later drops —
    // and now, also advisories a suggestion has already displaced. The notice must match
    // the badges exactly or it is noise.
    const countAt = src.indexOf("if (r.parAdvisory != null) unroutable.parReview += 1;");
    expect(countAt).toBeGreaterThan(src.indexOf("for (const rows of skusByVendor.values())"));
  });

  it("the walk instant's day-class comes from the ALREADY-DERIVED weekend flag", () => {
    // etWalkDay() is the one home for the day rule (AGENTS.md). A horizon derived from a
    // second `new Date().getDay()` could disagree with the weekend badge on the same page.
    expect(src.includes('dayClass: (weekend ? "weekend" : "weekday")')).toBe(true);
  });

  it("THE SUGGEST CHIP GOES THROUGH THE ONE AUTHORITY — no second spelling of the math", () => {
    // 2026-08-31: `suggestedOrderQty` and this line were byte-identical copies, which is
    // how the negative-on-hand bug shipped in BOTH at once (a clamp landing in one would
    // have left the other suggesting 38 cases of prosciutto against a par of 4). The copy
    // is gone; buildRow calls the shared authority, so the clamp is inherited, not
    // re-implemented. If this assertion ever fails because someone re-inlined the math,
    // that is the regression, not the test.
    expect(src.includes("suggestedQty = suggestedOrderQty(par, orderUnits)")).toBe(true);
    expect(src.includes("Math.ceil(par - orderUnits)")).toBe(false);
  });

  it("the RAW advisory survives the clamp — the observation is not overwritten", () => {
    // The clamp belongs to the SUGGESTION, not to the observation: `advisoryOnHand` keeps
    // the possibly-negative `orderUnits` so the walker can NAME the state ("use exceeds
    // recorded receipts") instead of rendering a silently-zeroed shelf. Clamping at the
    // source would destroy the only evidence the receiving history is incomplete.
    expect(src.includes("advisoryOnHand = { oz: adv.oz, orderUnits, source: adv.source }")).toBe(true);
  });
});

// ── THE NEGATIVE ADVISORY NAMES ITSELF, AT THE SOURCE (2026-08-31) ───────────────
//
// The render branch is inside a client component with no exported pure surface, so the
// source is again the only available assertion — same posture as the rules above.

describe("the walker's negative-advisory state", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "components", "ordering", "ParPassWalker.tsx"),
    "utf8",
  );
  const en = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "i18n", "en.json"), "utf8"),
  ) as Record<string, string>;
  const es = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "i18n", "es.json"), "utf8"),
  ) as Record<string, string>;

  it("renders a NAMED state, not the raw negative number and not silence", () => {
    expect(src.includes('t("ordering.row.advisory_negative")')).toBe(true);
    // The named branch is chosen by the sign, guarded by the display grain so float
    // residue (which already renders as "0") cannot cry wolf.
    expect(src.includes("sku.advisoryOnHand.orderUnits <= -DISPLAY_GRAIN")).toBe(true);
    expect(src.includes("const DISPLAY_GRAIN = 0.05")).toBe(true);
  });

  it("speaks in the warn lane's TEXT token, never the fill token", () => {
    // AGENTS.md token law: `co-warning` is a fill/dot/border role and measures 1.95:1 as
    // text; `co-warning-text` is the text role. The named state must use the latter.
    const at = src.indexOf('t("ordering.row.advisory_negative")');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 900), at);
    expect(block.includes("text-co-warning-text")).toBe(true);
    expect(/className="text-co-warning"/.test(block)).toBe(false);
  });

  it("keeps the raw negative reachable in the tooltip rather than destroying it", () => {
    expect(src.includes('t("ordering.row.advisory_negative_detail"')).toBe(true);
  });

  it("ships en + es for every new string INCLUDING the ARIA label (i18n law)", () => {
    for (const key of [
      "ordering.row.advisory_negative",
      "ordering.row.advisory_negative_aria",
      "ordering.row.advisory_negative_detail",
    ]) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(es[key], `es missing ${key}`).toBeTruthy();
      expect(es[key], `es untranslated for ${key}`).not.toBe(en[key]);
    }
    expect(src.includes('aria-label={t("ordering.row.advisory_negative_aria"')).toBe(true);
  });
});
