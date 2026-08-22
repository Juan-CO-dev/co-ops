/**
 * Unit spine — the Dynamic Pars REASON LANE (plan Task 2.7).
 *
 * THE REASON LANE IS THE PRODUCT. v1 can honestly answer for ~14 rows out of ~282; the other
 * ~268 each name the errand that would wake them. So this vocabulary is CLOSED (a TS union,
 * compiler-enforced, the AuditAction posture) and the cause ladder is FIRST-CAUSE-WINS with
 * `inventory_only` at the top — 57 of 141 par'd SKUs are packaging, and an errand row for
 * each would put 57 false chores at the head of Juan's list on day one (the parReviewAdvisory
 * precedent: a lane that cries wolf gets scrolled past).
 */
import { describe, it, expect } from "vitest";
import {
  ERRAND_REASONS,
  PAR_REASON_CODES,
  SILENCING_REASONS,
  classifyParReason,
  shouldBadgeSilencePerRow,
  type ParReasonCode,
  type ParReasonInput,
} from "../lib/dynamic-pars-shared";

/**
 * The compiler is the closure guard: adding a member to `ParReasonCode` fails to typecheck
 * here until it is also declared in `PAR_REASON_CODES`. Same shape as tests/readiness.test.ts's
 * KNOWN_REASONS invariant, minus the i18n half — the copy keys land in Phase 4 (Task 4.8).
 */
const EVERY_REASON: Record<ParReasonCode, true> = {
  ok: true,
  inventory_only: true,
  product_retired: true,
  no_lane_start: true,
  no_production_capture: true,
  no_weight_basis: true,
  unresolvable_pack: true,
  no_vendor_rhythm: true,
  thin_history: true,
  stale_depletion: true,
  no_local_history: true,
  zero_target: true,
  par_unit_suspect: true,
  below_band_resolution: true,
  budget_spent: true,
  pinned: true,
  slot_creation: true,
  cushion_class_missing: true,
};

/** Everything wired so the ladder falls all the way through to "ok". */
function input(over: Partial<ParReasonInput> = {}): ParReasonInput {
  return {
    inventoryOnly: false,
    productRetired: false,
    depletionCurrent: true,
    laneNeverStarted: false,
    laneComplete: true,
    perOrderUnitOz: 96,
    hasPackChain: true,
    hasRhythm: true,
    thin: false,
    slotExists: true,
    noLocalHistory: false,
    ...over,
  };
}

describe("the reason vocabulary is CLOSED", () => {
  it("declares exactly the union's members, with no duplicates", () => {
    expect([...PAR_REASON_CODES].sort()).toEqual(Object.keys(EVERY_REASON).sort());
    expect(new Set(PAR_REASON_CODES).size).toBe(PAR_REASON_CODES.length);
    expect(PAR_REASON_CODES).toHaveLength(18);
  });

  it("keeps SILENCING_REASONS a strict subset of the vocabulary", () => {
    for (const code of SILENCING_REASONS) expect(PAR_REASON_CODES).toContain(code);
    expect(SILENCING_REASONS.size).toBeLessThan(PAR_REASON_CODES.length);
  });

  it("keeps ERRAND_REASONS a strict subset of the vocabulary", () => {
    for (const code of ERRAND_REASONS) expect(PAR_REASON_CODES).toContain(code);
  });

  it("never silences on `ok` — a rendered number is not a silence", () => {
    expect(SILENCING_REASONS.has("ok")).toBe(false);
  });

  it("never silences on `cushion_class_missing` — cushion is INFORMATIONAL (r2-13)", () => {
    expect(SILENCING_REASONS.has("cushion_class_missing")).toBe(false);
    expect(ERRAND_REASONS).toContain("cushion_class_missing");
  });

  it("annotates rather than silences the codes that ride a rendered number", () => {
    // These four describe a number that DID render (or an auto lane that did not fire).
    for (const code of ["below_band_resolution", "budget_spent", "pinned"] as const) {
      expect(SILENCING_REASONS.has(code)).toBe(false);
    }
  });

  it("orders ERRAND_REASONS along r2-13's data critical path: weight → rhythm → cushion", () => {
    expect(ERRAND_REASONS).toEqual([
      "no_weight_basis",
      "unresolvable_pack",
      "no_vendor_rhythm",
      "no_production_capture",
      "par_unit_suspect",
      "cushion_class_missing",
    ]);
  });
});

describe("classifyParReason — first cause wins, and the order is the whole point", () => {
  it("returns ok when every lane is lit", () => {
    expect(classifyParReason(input())).toBe("ok");
  });

  it("ranks inventory_only FIRST — above every other fault", () => {
    const everythingBroken = input({
      inventoryOnly: true,
      productRetired: true,
      depletionCurrent: false,
      laneNeverStarted: true,
      laneComplete: false,
      perOrderUnitOz: null,
      hasRhythm: false,
      thin: true,
      slotExists: false,
      noLocalHistory: true,
    });
    expect(classifyParReason(everythingBroken)).toBe("inventory_only");
  });

  it("ranks product_retired above every fault but inventory_only (#283 suppression)", () => {
    expect(classifyParReason(input({ productRetired: true, perOrderUnitOz: null }))).toBe(
      "product_retired",
    );
    expect(classifyParReason(input({ inventoryOnly: true, productRetired: true }))).toBe(
      "inventory_only",
    );
  });

  it("ranks stale_depletion above the data-shape causes — never compute on a stale day", () => {
    expect(classifyParReason(input({ depletionCurrent: false }))).toBe("stale_depletion");
    expect(
      classifyParReason(input({ depletionCurrent: false, perOrderUnitOz: null, thin: true })),
    ).toBe("stale_depletion");
  });

  it("separates no_weight_basis from unresolvable_pack — two different errands", () => {
    expect(classifyParReason(input({ perOrderUnitOz: null, hasPackChain: false }))).toBe(
      "no_weight_basis",
    );
    expect(classifyParReason(input({ perOrderUnitOz: null, hasPackChain: true }))).toBe(
      "unresolvable_pack",
    );
  });

  it("ranks the denominator above the history causes (r2-13: coverage is dead without weight)", () => {
    expect(
      classifyParReason(input({ perOrderUnitOz: null, hasPackChain: false, laneNeverStarted: true })),
    ).toBe("no_weight_basis");
  });

  it("names no_local_history for the cold-start location (the sibling seam, unwired)", () => {
    expect(classifyParReason(input({ noLocalHistory: true, laneNeverStarted: true }))).toBe(
      "no_local_history",
    );
  });

  it("names no_lane_start for a NULL lane_start_at (r3)", () => {
    expect(classifyParReason(input({ laneNeverStarted: true }))).toBe("no_lane_start");
  });

  it("names no_production_capture for the HALF-SEEN base — the live universal case", () => {
    expect(classifyParReason(input({ laneComplete: false }))).toBe("no_production_capture");
    // Live today `production_inputs` has 0 rows, so every prep-mediated SKU lands here.
    expect(SILENCING_REASONS.has("no_production_capture")).toBe(true);
  });

  it("names no_vendor_rhythm when nobody has authored a truck (all 141 SKUs today)", () => {
    expect(classifyParReason(input({ hasRhythm: false }))).toBe("no_vendor_rhythm");
  });

  it("ranks the lane causes above rhythm, and rhythm above thin history", () => {
    expect(classifyParReason(input({ laneComplete: false, hasRhythm: false }))).toBe(
      "no_production_capture",
    );
    expect(classifyParReason(input({ hasRhythm: false, thin: true }))).toBe("no_vendor_rhythm");
  });

  it("names thin_history last among the data causes", () => {
    expect(classifyParReason(input({ thin: true }))).toBe("thin_history");
  });

  it("names slot_creation for a day-class with no par slot (121 SKUs have no weekend par)", () => {
    expect(classifyParReason(input({ slotExists: false }))).toBe("slot_creation");
    // …but any real data fault outranks it: an absent slot is not the errand to run first.
    expect(classifyParReason(input({ slotExists: false, thin: true }))).toBe("thin_history");
  });
});

describe("shouldBadgeSilencePerRow — the lane lights ITSELF (plan D15)", () => {
  it("stays dark while silence is the majority — today's answer", () => {
    expect(shouldBadgeSilencePerRow(268, 282)).toBe(false); // v1's live shape
    expect(shouldBadgeSilencePerRow(94, 100)).toBe(false);
  });

  it("lights up once silence becomes the MINORITY — no flag, no future PR", () => {
    expect(shouldBadgeSilencePerRow(49, 100)).toBe(true);
    expect(shouldBadgeSilencePerRow(1, 282)).toBe(true);
    expect(shouldBadgeSilencePerRow(0, 100)).toBe(true);
  });

  it("treats an exact half as still-the-norm (strictly less than 0.5 lights it)", () => {
    expect(shouldBadgeSilencePerRow(50, 100)).toBe(false);
  });

  it("never badges an empty walk", () => {
    expect(shouldBadgeSilencePerRow(0, 0)).toBe(false);
    expect(shouldBadgeSilencePerRow(5, -1)).toBe(false);
  });
});
