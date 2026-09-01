/**
 * Unit spine — lib/dynamic-pars-shared.ts primitives, THE GUARD STACK and the graduation
 * seams (plan Tasks 2.1, 2.8, 2.9).
 *
 * The guard stack is ONE function run in two modes: shadow records the verdict it WOULD have
 * executed, live executes it (r2-7). Every suppression is attributed to the guard that caused
 * it, so the stack is battle-tested on real nightly data before the write bit is ever flipped.
 *
 * The four r3 QUARANTINES each get a case proving NO NUMBER is emitted — they are collected in
 * one block at the end of this file, because "the engine refuses to answer" is the single
 * property v1 is measured on.
 *
 * ⚠ TWO PLACES where Task 2.8's bullet arithmetic and Task 2.8's own code block disagree are
 * pinned AS THE CODE BEHAVES and flagged F1/F2 for the lead; see the comments at each site.
 */
import { describe, it, expect } from "vitest";
import {
  CUSHION_BY_CLASS,
  CUSHION_DEFAULT,
  DYNAMIC_PARS,
  applyGuardStack,
  computeCoverage,
  classifyParReason,
  generationIdFor,
  parStepFor,
  roundToStep,
  siblingBlendWeight,
  stabilizeSuggestion,
  suggestedOrderQty,
  trustRampState,
  type GuardInput,
} from "../lib/dynamic-pars-shared";

describe("roundToStep", () => {
  it("rounds to the nearest multiple of the step", () => {
    expect(roundToStep(2.6, 0.25)).toBe(2.5);
    expect(roundToStep(2.63, 0.25)).toBe(2.75);
    expect(roundToStep(2.6, 1)).toBe(3);
  });

  it("kills float drift at the step grain", () => {
    expect(roundToStep(0.1 + 0.2, 0.25)).toBe(0.25);
    // 0.30000000000000004 must not survive into a rendered par.
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("returns the value untouched on a non-positive step or a non-finite value", () => {
    expect(roundToStep(2.6, 0)).toBe(2.6);
    expect(roundToStep(2.6, -1)).toBe(2.6);
    expect(roundToStep(Number.NaN, 0.25)).toBeNaN();
  });
});

describe("parStepFor", () => {
  it("honours an explicitly authored par_step over any inference", () => {
    expect(parStepFor({ parStep: 0.5, weekdayPar: 3, weekendPar: null })).toBe(0.5);
    // A 0.25-grain par does NOT override the author.
    expect(parStepFor({ parStep: 2, weekdayPar: 0.25, weekendPar: null })).toBe(2);
  });

  it("ignores a non-positive authored step and falls back to the inference", () => {
    expect(parStepFor({ parStep: 0, weekdayPar: 3, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: -1, weekdayPar: 1.5, weekendPar: null })).toBe(0.5);
  });

  it("infers 0.25 from a quarter-grain par (the 36 deliberately fractional SKUs)", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 0.25, weekendPar: null })).toBe(0.25);
    expect(parStepFor({ parStep: null, weekdayPar: 2.75, weekendPar: null })).toBe(0.25);
    // Either par can carry the grain — the finer one wins.
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: 1.25 })).toBe(0.25);
  });

  it("infers 0.5 from a half-grain par", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 1.5, weekendPar: null })).toBe(0.5);
    expect(parStepFor({ parStep: null, weekdayPar: 1.5, weekendPar: 2.5 })).toBe(0.5);
  });

  it("infers 1 from whole pars, and from no pars at all", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: 4 })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: null, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: 0, weekendPar: null })).toBe(1);
  });
});

describe("CUSHION_BY_CLASS", () => {
  it("carries the six shipped policy classes, all as fractions", () => {
    expect(Object.keys(CUSHION_BY_CLASS).sort()).toEqual([
      "bakery",
      "dairy",
      "dry",
      "frozen",
      "produce",
      "protein",
    ]);
    for (const pct of Object.values(CUSHION_BY_CLASS)) {
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(1);
    }
  });

  it("has a conservative default for the un-classed SKU — cushion never silences a par", () => {
    expect(CUSHION_DEFAULT).toBe(0.2);
  });
});

describe("suggestedOrderQty — one engine for the par and the order line", () => {
  it("refuses a quantity when on-hand is unknown", () => {
    expect(suggestedOrderQty(3, null)).toBeNull();
  });

  it("orders up to the par and CEILS to a whole order unit (r2)", () => {
    expect(suggestedOrderQty(3, 1.2)).toBe(2);
    expect(suggestedOrderQty(3, 0)).toBe(3);
    // A fractional par is real, but you cannot order a quarter case.
    expect(suggestedOrderQty(2.75, 0.5)).toBe(3);
    expect(suggestedOrderQty(0.25, 0)).toBe(1);
  });

  it("never suggests a negative quantity when the shelf is over par", () => {
    expect(suggestedOrderQty(3, 4)).toBe(0);
    expect(suggestedOrderQty(3, 3)).toBe(0);
  });

  // ── A NEGATIVE ADVISORY IS A DATA SIGNAL, NEVER A BIGGER ORDER (2026-08-31) ──────
  //
  // Juan's walk smoke found the Suggest chip offering ~19 on a drink whose par is a
  // fraction of that. Diagnosis against prod: the advisory on-hand is receipts minus
  // consumption with NO count anchor (zero sku_count_events exist), so a SKU with an
  // EMPTY receiving history and real consumption runs arbitrarily negative — P Street
  // Prosciutto had 0 oz ever received against 407 oz consumed, ≈ −34 order units, and
  // `par − (−34)` suggested 38 cases against a par of 4. A shelf cannot hold negative
  // cans, so a negative means "recorded use exceeds recorded receipts" (the receiving
  // history is incomplete) and the honest suggestion is par-from-empty.
  it("FLOORS a negative advisory at zero — the prod prosciutto case", () => {
    expect(suggestedOrderQty(4, -34)).toBe(4); // was 38.
    expect(suggestedOrderQty(4, -34)).not.toBe(38);
  });

  it("degrades a negative advisory to exactly the par-from-empty answer, for any par", () => {
    // The clamp must be indistinguishable from "the shelf is empty" — not a partial
    // credit for the negative, and not a refusal (null) either: the par is still real.
    for (const par of [1, 4, 7.5, 12]) {
      expect(suggestedOrderQty(par, -34)).toBe(suggestedOrderQty(par, 0));
      expect(suggestedOrderQty(par, -0.0001)).toBe(suggestedOrderQty(par, 0));
    }
  });

  it("clamps UNCONDITIONALLY, so float residue can never ceil an extra unit on", () => {
    // The renderer's named-state threshold is epsilon-gated (display grain); this math is
    // deliberately NOT. Un-clamped, ceil(4 − (−0.0001)) = 5 — a whole phantom case.
    expect(suggestedOrderQty(4, -0.0001)).toBe(4);
    expect(suggestedOrderQty(4, -0.5)).toBe(4);
  });

  it("keeps the clamp INSIDE the authority, so every consumer inherits it", () => {
    // The clamp is not applied at call sites: lib/ordering.ts buildRow and
    // ParSuggestionRow's accept-recompute both route here, and a call-site clamp would be
    // a second opinion about what a negative shelf means — the same shape of hole the
    // former byte-identical inline copy already proved. Asserted behaviourally: the
    // function itself, called with a raw negative, must already be safe.
    expect(suggestedOrderQty(4, -34)).toBe(4);
    // ...and the null contract is unchanged by the clamp (unknown ≠ empty).
    expect(suggestedOrderQty(4, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.8 — the guard stack
// ─────────────────────────────────────────────────────────────────────────────

function guard(over: Partial<GuardInput> = {}): GuardInput {
  return {
    locationId: "loc-1",
    skuId: "sku-1",
    dayClass: "weekday",
    currentPar: 4,
    targetUnits: 4.6,
    parStep: 1,
    priorSuggestedPar: null,
    priorGenerationId: null,
    directionConfirmed: true,
    budgetSpent: false,
    pinned: false,
    mode: "shadow",
    ...over,
  };
}

describe("applyGuardStack — the band, in PAR STEPS (r2's THE FIX)", () => {
  it("auto-tiers a within-band move: par 4, step 1, target 4.6 ⇒ 5", () => {
    const res = applyGuardStack(guard());
    expect(res.tier).toBe("auto");
    expect(res.suggestedPar).toBe(5);
    expect(res.outcome).toBe("would_apply");
    expect(res.suppressedBy).toBeNull();
    expect(res.reasonCode).toBe("ok");
  });

  it("holds a fractional par to its OWN quantum: par 0.25, step 0.25, target 0.5", () => {
    const res = applyGuardStack(guard({ currentPar: 0.25, parStep: 0.25, targetUnits: 0.5 }));
    // r2-on-r2: `max(1 unit, 25%)` would have inflated this 0.25-case par toward 4.
    expect(res.suggestedPar).toBe(0.5);
    expect(res.tier).toBe("suggestion");
    expect(res.reasonCode).toBe("below_band_resolution");
  });

  it("emits no move at all when the target is inside one step of the standing par", () => {
    const res = applyGuardStack(guard({ currentPar: 4, targetUnits: 4.2 }));
    expect(res.tier).toBe("none");
    expect(res.suggestedPar).toBeNull();
    expect(res.outcome).toBe("advisory_null");
    expect(res.reasonCode).toBe("ok");
  });

  it("sends a BEYOND-BAND move to the suggestion lane at the honest target", () => {
    // par 10, step 1, target 13: Δ3 against a cap of max(1, 2.5) = 2.5. LEAD RULING F1: the
    // band is a GATE — beyond it nothing moves itself and the manager sees the un-clipped
    // number ("Bigger moves are suggestions"). Task 2.8's "assert 12" bullet is OVERRULED.
    const res = applyGuardStack(guard({ currentPar: 10, targetUnits: 13 }));
    expect(res.tier).toBe("suggestion");
    expect(res.suggestedPar).toBe(13);
    expect(res.suppressedBy).toBe("band");
    expect(res.reasonCode).toBe("ok");
    expect(res.outcome).toBe("suppressed");
    expect(res.tier).not.toBe("auto"); // never a unilateral 10 → 13, and never a clipped 12
  });

  it("tests the band on the ROUNDED delta — council P2-2's 30% escape is closed", () => {
    // THE P2-2 REGRESSION. par 10, raw target 12.5: the RAW delta is 2.5, which slips through
    // a ≤2.5 cap — and only then rounds to 13, applying a 30% move under a 25% band. Because
    // the target is rounded BEFORE the band is tested (that IS "the cap clamps after
    // rounding"), the tested delta is 3 and the move is refused. This is the case a raw-delta
    // band test would have wrongly auto-applied.
    const res = applyGuardStack(guard({ currentPar: 10, targetUnits: 12.5 }));
    expect(res.suggestedPar).toBe(13);
    expect(res.suppressedBy).toBe("band");
    expect(res.tier).toBe("suggestion");
    expect(res.tier).not.toBe("auto");
    expect(res.outcome).not.toBe("applied");
    expect(res.outcome).not.toBe("would_apply");
  });

  it("keeps a 25%-of-par move inside the band on a large par", () => {
    // par 10, target 12: Δ2 ≤ cap 2.5 ⇒ auto.
    const res = applyGuardStack(guard({ currentPar: 10, targetUnits: 12 }));
    expect(res.tier).toBe("auto");
    expect(res.suggestedPar).toBe(12);
  });
});

describe("applyGuardStack — pars below the band's resolution are MANUAL-ONLY (r3)", () => {
  it("never auto-moves a par of 3 steps, however confident the target", () => {
    const res = applyGuardStack(guard({ currentPar: 3, targetUnits: 4 }));
    expect(res.tier).toBe("suggestion");
    expect(res.suppressedBy).toBe("below_band_resolution");
    expect(res.reasonCode).toBe("below_band_resolution");
    expect(res.suggestedPar).toBe(4);
  });

  it("holds the line across every par below MIN_STEPS_FOR_AUTO", () => {
    expect(DYNAMIC_PARS.MIN_STEPS_FOR_AUTO).toBe(4);
    for (const currentPar of [1, 2, 3]) {
      const res = applyGuardStack(guard({ currentPar, targetUnits: currentPar + 1 }));
      expect(res.tier).not.toBe("auto");
      expect(res.suppressedBy).toBe("below_band_resolution");
    }
    // 4 steps is the first par the machine may touch — at CO, 108 of 141 pars are below it.
    expect(applyGuardStack(guard({ currentPar: 4, targetUnits: 5 })).tier).toBe("auto");
  });

  it("counts STEPS, not units — a 1.0 par at a 0.25 step is 4 steps and qualifies", () => {
    const res = applyGuardStack(guard({ currentPar: 1, parStep: 0.25, targetUnits: 1.25 }));
    expect(res.tier).toBe("auto");
    expect(res.suggestedPar).toBe(1.25);
  });
});

describe("applyGuardStack — slot creation is suggestion-only FOREVER", () => {
  it("never creates a par slot that does not exist (121 SKUs have no weekend par)", () => {
    const res = applyGuardStack(guard({ dayClass: "weekend", currentPar: null, targetUnits: 3 }));
    expect(res.tier).toBe("suggestion");
    expect(res.outcome).toBe("suppressed");
    expect(res.suppressedBy).toBe("slot_creation");
    expect(res.reasonCode).toBe("slot_creation");
    expect(res.slotCreation).toBe(true);
    expect(res.suggestedPar).toBe(3);
  });

  it("marks the generation with an absent current par so the pair is unambiguous", () => {
    const res = applyGuardStack(guard({ currentPar: null, targetUnits: 3 }));
    expect(res.generationId).toBe("loc-1:sku-1:weekday:none>3");
  });

  it("reports slotCreation false whenever the slot exists", () => {
    expect(applyGuardStack(guard()).slotCreation).toBe(false);
  });
});

describe("applyGuardStack — budget, pin and hysteresis", () => {
  it("gives a within-band-but-budget-blocked delta its OWN cause (never a silent stale par)", () => {
    const res = applyGuardStack(guard({ budgetSpent: true }));
    expect(res.outcome).toBe("suppressed");
    expect(res.suppressedBy).toBe("budget");
    expect(res.reasonCode).toBe("budget_spent");
    expect(res.tier).toBe("suggestion");
    expect(res.suggestedPar).toBe(5);
    expect(DYNAMIC_PARS.BUDGET_MOVES).toBe(1);
    expect(DYNAMIC_PARS.BUDGET_WINDOW_DAYS).toBe(7);
  });

  it("lets a PIN stop the machine while the suggestion keeps talking", () => {
    const res = applyGuardStack(guard({ pinned: true }));
    expect(res.outcome).toBe("suppressed");
    expect(res.suppressedBy).toBe("pin");
    expect(res.reasonCode).toBe("pinned");
    expect(res.suggestedPar).toBe(5); // the conversation is not over — only the unilateral write
  });

  it("ranks the PIN above hysteresis and budget", () => {
    const res = applyGuardStack(guard({ pinned: true, directionConfirmed: false, budgetSpent: true }));
    expect(res.suppressedBy).toBe("pin");
  });

  it("requires the direction to be confirmed across two consecutive runs", () => {
    const firstRun = applyGuardStack(guard({ directionConfirmed: false }));
    expect(firstRun.outcome).toBe("suppressed");
    expect(firstRun.suppressedBy).toBe("hysteresis");
    expect(firstRun.reasonCode).toBe("ok");
    expect(firstRun.suggestedPar).toBe(5);

    const secondRun = applyGuardStack(guard({ directionConfirmed: true }));
    expect(secondRun.outcome).toBe("would_apply");
    expect(secondRun.tier).toBe("auto");
    expect(DYNAMIC_PARS.HYSTERESIS_CONFIRM_RUNS).toBe(2);
  });
});

describe("generationIdFor + stabilizeSuggestion — one offer, one identity", () => {
  it("keeps ONE generation while a drifting target rounds to the same step", () => {
    const a = applyGuardStack(guard({ targetUnits: 4.6 }));
    const b = applyGuardStack(guard({ targetUnits: 5.4 }));
    expect(a.generationId).toBe(b.generationId);
    expect(a.generationId).toBe("loc-1:sku-1:weekday:4>5");
    // NB: Task 2.8's bullet used 4.4 → 4.6 for this case, but 4.4 rounds to 4 at step 1,
    // which is "no movement worth rendering". 4.6/5.4 is the same test with live arithmetic.
    expect(applyGuardStack(guard({ targetUnits: 4.4 })).generationId).toBeNull();
  });

  it("mints a NEW generation when the offer moves", () => {
    const five = applyGuardStack(guard({ targetUnits: 4.6 }));
    const six = applyGuardStack(guard({ targetUnits: 6 }));
    expect(six.generationId).not.toBe(five.generationId);
    expect(six.generationId).toBe("loc-1:sku-1:weekday:4>6");
  });

  it("mints a NEW generation when a human edits the standing par", () => {
    expect(generationIdFor("loc-1", "sku-1", "weekday", 4, 5)).not.toBe(
      generationIdFor("loc-1", "sku-1", "weekday", 5, 5),
    );
    const beforeEdit = applyGuardStack(guard({ currentPar: 4, targetUnits: 5 }));
    const afterEdit = applyGuardStack(guard({ currentPar: 3, targetUnits: 5 }));
    expect(beforeEdit.generationId).toBe("loc-1:sku-1:weekday:4>5");
    expect(afterEdit.generationId).toBe("loc-1:sku-1:weekday:3>5");
  });

  it("keys the generation by location and day-class — no global par identity anywhere", () => {
    expect(generationIdFor("loc-1", "sku-1", "weekday", 4, 5)).not.toBe(
      generationIdFor("loc-2", "sku-1", "weekday", 4, 5),
    );
    expect(generationIdFor("loc-1", "sku-1", "weekday", 4, 5)).not.toBe(
      generationIdFor("loc-1", "sku-1", "weekend", 4, 5),
    );
  });

  it("adopts any candidate when nothing is standing", () => {
    expect(stabilizeSuggestion(null, 5, 1)).toBe(5);
  });

  it("holds a standing suggestion against a SUB-STEP wobble", () => {
    expect(stabilizeSuggestion(5, 5.1, 0.25)).toBe(5);
    expect(stabilizeSuggestion(5, 4.9, 0.25)).toBe(5);
  });

  it("measures the deadband in STEPS, not units", () => {
    // The same 0.5 drift is noise at a step of 1 and a real move at a step of 0.25.
    expect(stabilizeSuggestion(5, 5.5, 1)).toBe(5);
    expect(stabilizeSuggestion(5, 5.5, 0.25)).toBe(5.5);
    expect(DYNAMIC_PARS.SUGGESTION_DEADBAND_STEPS).toBe(1);
  });

  it("DAMPS a one-step wobble: the walker may not read 12 → 1 Monday and 12 → 2 Tuesday", () => {
    // LEAD RULING F2: r3's sentence is behavioural, so the deadband comparison is `<=` and a
    // candidate exactly one step from the standing suggestion does NOT displace it.
    expect(stabilizeSuggestion(1, 2, 1)).toBe(1);
    expect(stabilizeSuggestion(5, 5.25, 0.25)).toBe(5);
    expect(stabilizeSuggestion(5, 4.75, 0.25)).toBe(5);
    // Accepted cost: a PERMANENT one-step drift stays unrendered until it reaches two steps.
    expect(stabilizeSuggestion(1, 3, 1)).toBe(3);
    expect(stabilizeSuggestion(5, 5.5, 0.25)).toBe(5.5);
  });
});

describe("applyGuardStack — shadow SIMULATES, it does not fork (r2-7)", () => {
  it("records would_apply in shadow and applied in live for the same passing move", () => {
    const shadow = applyGuardStack(guard({ mode: "shadow" }));
    const live = applyGuardStack(guard({ mode: "live" }));
    expect(shadow.outcome).toBe("would_apply");
    expect(live.outcome).toBe("applied");
    expect(shadow.suggestedPar).toBe(live.suggestedPar);
    expect(shadow.tier).toBe(live.tier);
    expect(shadow.generationId).toBe(live.generationId);
  });

  it("records every SUPPRESSION identically in both modes — same code, one flag", () => {
    const suppressions: Array<Partial<GuardInput>> = [
      { budgetSpent: true },
      { pinned: true },
      { directionConfirmed: false },
      { currentPar: 3, targetUnits: 4 },
      { currentPar: null, targetUnits: 3 },
      { currentPar: 10, targetUnits: 13 },
      { currentPar: 2, targetUnits: 0 },
      { currentPar: 3, targetUnits: 8 },
    ];
    for (const over of suppressions) {
      expect(applyGuardStack(guard({ ...over, mode: "shadow" }))).toEqual(
        applyGuardStack(guard({ ...over, mode: "live" })),
      );
    }
  });

  it("never emits `applied` from shadow, whatever the inputs", () => {
    for (const targetUnits of [0, 1, 4.6, 5, 6, 13, 40]) {
      expect(applyGuardStack(guard({ targetUnits, mode: "shadow" })).outcome).not.toBe("applied");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR r3 QUARANTINES — each proves NO NUMBER is emitted
// ─────────────────────────────────────────────────────────────────────────────

describe("QUARANTINE 1 — a zero target is NEVER a suggestion", () => {
  it("refuses with zero_target and emits no number at all", () => {
    const res = applyGuardStack(guard({ currentPar: 2, targetUnits: 0 }));
    expect(res.reasonCode).toBe("zero_target");
    expect(res.outcome).toBe("advisory_null");
    expect(res.tier).toBe("none");
    expect(res.suggestedPar).toBeNull();
    expect(res.suggestedPar).not.toBe(0); // advisory-null, never a zeroed par
    expect(res.generationId).toBeNull();
  });

  it("refuses a target that ROUNDS to zero, and a negative one", () => {
    expect(applyGuardStack(guard({ currentPar: 2, targetUnits: 0.4 })).reasonCode).toBe("zero_target");
    expect(applyGuardStack(guard({ currentPar: 2, targetUnits: -3 })).reasonCode).toBe("zero_target");
    expect(applyGuardStack(guard({ currentPar: 2, targetUnits: 0.4 })).suggestedPar).toBeNull();
  });

  it("forbids auto-to-zero even from a large par — stopping a product is a human decision", () => {
    const res = applyGuardStack(guard({ currentPar: 12, targetUnits: 0 }));
    expect(res.tier).toBe("none");
    expect(res.suggestedPar).toBeNull();
  });
});

describe("QUARANTINE 2 — gross divergence is a UNIT problem, not a demand problem", () => {
  it("refuses a target above 200% of the standing par (the Fresh-Mozz eaches-vs-cases bomb)", () => {
    const res = applyGuardStack(guard({ currentPar: 3, targetUnits: 8 }));
    expect(res.reasonCode).toBe("par_unit_suspect");
    expect(res.outcome).toBe("advisory_null");
    expect(res.tier).toBe("none");
    expect(res.suggestedPar).toBeNull();
    expect(res.generationId).toBeNull();
  });

  it("refuses a target below 50% of the standing par", () => {
    const res = applyGuardStack(guard({ currentPar: 10, targetUnits: 4 }));
    expect(res.reasonCode).toBe("par_unit_suspect");
    expect(res.suggestedPar).toBeNull();
  });

  it("quarantines BEFORE any band arithmetic — a suspect unit never reaches the auto lane", () => {
    const res = applyGuardStack(guard({ currentPar: 20, targetUnits: 60, directionConfirmed: true }));
    expect(res.tier).toBe("none");
    expect(res.suppressedBy).toBeNull();
  });

  it("lets the exact 50% / 200% boundaries through — the quarantine is for gross divergence", () => {
    expect(applyGuardStack(guard({ currentPar: 3, targetUnits: 6 })).reasonCode).not.toBe(
      "par_unit_suspect",
    );
    expect(applyGuardStack(guard({ currentPar: 10, targetUnits: 5 })).reasonCode).not.toBe(
      "par_unit_suspect",
    );
    expect(DYNAMIC_PARS.UNIT_SUSPECT_LOW).toBe(0.5);
    expect(DYNAMIC_PARS.UNIT_SUSPECT_HIGH).toBe(2);
  });
});

describe("QUARANTINE 3 — a par of ≤3 steps is below the band's resolution", () => {
  it("renders a suggestion and NEVER an auto move", () => {
    const res = applyGuardStack(guard({ currentPar: 3, targetUnits: 4, directionConfirmed: true }));
    expect(res.tier).toBe("suggestion");
    expect(res.outcome).toBe("suppressed");
    expect(res.suppressedBy).toBe("below_band_resolution");
    expect(res.outcome).not.toBe("applied");
    expect(res.outcome).not.toBe("would_apply");
  });

  it("labels the row so the walker can say WHY it is manual-only", () => {
    expect(applyGuardStack(guard({ currentPar: 2, targetUnits: 3 })).reasonCode).toBe(
      "below_band_resolution",
    );
  });
});

describe("QUARANTINE 4 — no honest denominator means no number reaches the guard stack", () => {
  it("refuses a coverage target when oz-per-order-unit is unresolvable", () => {
    const coverage = computeCoverage({
      coveredDays: ["2026-08-25", "2026-08-26"],
      baseOzPerDay: { weekday: 30, weekend: 45 },
      velocityRatio: 1,
      cushionPct: 0.2,
      perOrderUnitOz: null,
      peakFloorOz: null,
    });
    expect(coverage).toBeNull(); // advisory-null — never a fabricated unit count, never 0
  });

  it("names the errand behind the refusal", () => {
    const base = {
      inventoryOnly: false,
      productRetired: false,
      depletionCurrent: true,
      laneNeverStarted: false,
      laneComplete: true,
      hasRhythm: true,
      thin: false,
      slotExists: true,
      noLocalHistory: false,
    };
    expect(classifyParReason({ ...base, perOrderUnitOz: null, hasPackChain: false })).toBe(
      "no_weight_basis",
    );
    expect(classifyParReason({ ...base, perOrderUnitOz: null, hasPackChain: true })).toBe(
      "unresolvable_pack",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.9 — the graduation seams (both ship, neither is wired)
// ─────────────────────────────────────────────────────────────────────────────

describe("trustRampState — graduation widens the TRIGGER, never the write set", () => {
  const ramp = {
    offered: 14,
    accepted: 10,
    reverts: 0,
    hasDirectCountAnchor: true,
  };

  it("graduates on N accepted generations plus a physical count anchor", () => {
    expect(trustRampState(ramp)).toEqual({
      netAccepted: 10,
      offered: 14,
      met: true,
      blockedBy: null,
    });
    expect(DYNAMIC_PARS.TRUST_RAMP_ACCEPTS).toBe(10);
    expect(DYNAMIC_PARS.TRUST_RAMP_WINDOW_DAYS).toBe(90);
  });

  it("blocks one accept short", () => {
    const res = trustRampState({ ...ramp, accepted: 9 });
    expect(res.met).toBe(false);
    expect(res.blockedBy).toBe("ramp");
  });

  it("blocks on a missing count anchor — the live answer at both shops today", () => {
    // `sku_count_events` is 0 in prod, so no location can graduate, by construction.
    const res = trustRampState({ ...ramp, hasDirectCountAnchor: false });
    expect(res.met).toBe(false);
    expect(res.blockedBy).toBe("count_anchor");
    expect(res.netAccepted).toBe(10);
  });

  it("counts a post-graduation revert AGAINST standing (r2-2)", () => {
    const res = trustRampState({ ...ramp, reverts: 1 });
    expect(res.netAccepted).toBe(9);
    expect(res.met).toBe(false);
    expect(res.blockedBy).toBe("ramp");
  });

  it("floors net accepts at zero rather than going negative", () => {
    expect(trustRampState({ ...ramp, accepted: 2, reverts: 5 }).netAccepted).toBe(0);
  });

  it("echoes the denominator so the surface can say '10 of 14'", () => {
    expect(trustRampState({ ...ramp, offered: 22 }).offered).toBe(22);
  });
});

describe("siblingBlendWeight — the cold-start seam (NOT wired in v1)", () => {
  it("leans entirely on the sibling on day one", () => {
    expect(siblingBlendWeight(0, 21)).toBe(1);
    expect(siblingBlendWeight(0)).toBe(1); // the default qualifying window
  });

  it("decays linearly to zero as local observed days accumulate", () => {
    expect(siblingBlendWeight(7, 21)).toBe(0.666667);
    expect(siblingBlendWeight(7, 21)).toBeCloseTo(0.667, 3);
    expect(siblingBlendWeight(21, 21)).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(siblingBlendWeight(30, 21)).toBe(0);
    expect(siblingBlendWeight(-5, 21)).toBe(1);
    expect(siblingBlendWeight(5, 0)).toBe(0);
    expect(siblingBlendWeight(5, -1)).toBe(0);
    expect(DYNAMIC_PARS.SIBLING_QUALIFYING_DAYS).toBe(21);
  });
});
