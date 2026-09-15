/**
 * Unit spine — the Opening Report's Phase 2 outcome (LRA-205).
 *
 * `loadOpeningDetail` built every report row from the PHASE 1 completion only:
 * under dual membership (0196) an openingPhase2 item has both a phase-1 and a
 * phase-2 live row, the map preferred phase 1, and `readPhase1SpotCheck` was the
 * only reader of `prep_data`. So `prep_data->phase2` — written by
 * `save_phase2_item_atomic` (migration 0056) and holding the number Phase 2
 * exists to produce — never reached the model, and a manager reading a finalized
 * opening saw the verification but never its outcome.
 *
 * Two contracts are pinned here:
 *   1. `readPhase2Outcome` maps the persisted 14-field object defensively (this
 *      is an untyped JSONB boundary, same posture as its phase-1 sibling).
 *   2. The report's opener-prepped line OPENS with the exact words of
 *      `opening.phase2.opener_prepped_label` in BOTH languages. The opening
 *      journey (`scripts/sim/launch-readiness/journeys/opening.spec.ts`) asserts
 *      "<label>, optional colon, <opener_prepped>" over the rendered row, so a
 *      copy edit to either string silently breaks a live journey. This test is
 *      the cheap, always-run half of that contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readPhase2Outcome } from "@/lib/reports-hub";

/** The full §8.4 object as `save_phase2_item_atomic` writes it: 14 fields. */
const FULL_PHASE2 = {
  phase: 2,
  closer_count: 4,
  spot_check_status: "flagged_recount",
  opener_recount: 2,
  ground_truth_count: 2,
  prep_need: 6,
  opener_prepped: 9,
  delta_vs_prep_need: 3,
  over_under_status: "over_prep",
  over_under_reason_category: "management_directive",
  over_under_reason_text: "Keith asked for extra before the catering pickup",
  directed_by: "11111111-1111-4111-8111-111111111111",
  saved_at: "2026-09-15T12:34:56.789+00:00",
  saved_by: "22222222-2222-4222-8222-222222222222",
} as const;

describe("readPhase2Outcome", () => {
  it("maps the full 14-field persisted row", () => {
    expect(readPhase2Outcome({ phase2: FULL_PHASE2 })).toEqual({
      openerPrepped: 9,
      deltaVsPrepNeed: 3,
      overUnderStatus: "over_prep",
      reasonCategory: "management_directive",
      reasonText: "Keith asked for extra before the catering pickup",
      directedById: "11111111-1111-4111-8111-111111111111",
      savedById: "22222222-2222-4222-8222-222222222222",
      savedAt: "2026-09-15T12:34:56.789+00:00",
    });
  });

  it("keeps an at-par row whose reason fields are all NULL", () => {
    const out = readPhase2Outcome({
      phase2: {
        ...FULL_PHASE2,
        opener_prepped: 6,
        delta_vs_prep_need: 0,
        over_under_status: "at_par",
        over_under_reason_category: null,
        over_under_reason_text: null,
        directed_by: null,
      },
    });
    expect(out).not.toBeNull();
    expect(out!.openerPrepped).toBe(6);
    expect(out!.deltaVsPrepNeed).toBe(0);
    expect(out!.overUnderStatus).toBe("at_par");
    expect(out!.reasonCategory).toBeNull();
    expect(out!.reasonText).toBeNull();
    expect(out!.directedById).toBeNull();
  });

  it("carries a par-null item: delta is NULL while the prepped quantity stands", () => {
    const out = readPhase2Outcome({
      phase2: { ...FULL_PHASE2, delta_vs_prep_need: null, over_under_status: "at_par" },
    });
    expect(out!.openerPrepped).toBe(9);
    expect(out!.deltaVsPrepNeed).toBeNull();
  });

  it("degrades every odd or missing optional field to null", () => {
    const out = readPhase2Outcome({
      phase2: {
        opener_prepped: 5,
        delta_vs_prep_need: "3", // string, not number
        over_under_status: "wildly_over", // outside the closed vocabulary
        over_under_reason_category: "", // empty string is not a category
        over_under_reason_text: 42, // wrong type
        directed_by: null,
        // saved_at / saved_by absent entirely
      },
    });
    expect(out).toEqual({
      openerPrepped: 5,
      deltaVsPrepNeed: null,
      overUnderStatus: null,
      reasonCategory: null,
      reasonText: null,
      directedById: null,
      savedById: null,
      savedAt: null,
    });
  });

  it("returns null for a phase-1-only row (the dual-membership sibling)", () => {
    expect(
      readPhase2Outcome({
        phase1: { opener_recount: 2, ground_truth_count: 2, prep_need: 6 },
      }),
    ).toBeNull();
  });

  it("returns null when prep_data carries no phase2 key, or none at all", () => {
    expect(readPhase2Outcome(null)).toBeNull();
    expect(readPhase2Outcome(undefined)).toBeNull();
    expect(readPhase2Outcome({})).toBeNull();
    expect(readPhase2Outcome("phase2")).toBeNull();
    expect(readPhase2Outcome({ phase2: null })).toBeNull();
    expect(readPhase2Outcome({ phase2: "over_prep" })).toBeNull();
  });

  it("returns null when opener_prepped is absent or not a finite number", () => {
    // The RPC raises `opener_prepped_missing` rather than write such a row, so
    // there is no outcome to render — null, never a half-built block.
    const withoutPrepped: Record<string, unknown> = { ...FULL_PHASE2 };
    delete withoutPrepped.opener_prepped;
    expect(readPhase2Outcome({ phase2: withoutPrepped })).toBeNull();
    expect(readPhase2Outcome({ phase2: { ...FULL_PHASE2, opener_prepped: null } })).toBeNull();
    expect(readPhase2Outcome({ phase2: { ...FULL_PHASE2, opener_prepped: "9" } })).toBeNull();
    expect(readPhase2Outcome({ phase2: { ...FULL_PHASE2, opener_prepped: NaN } })).toBeNull();
  });

  it("preserves a fractional quantity exactly (numeric column, not an integer)", () => {
    expect(
      readPhase2Outcome({ phase2: { ...FULL_PHASE2, opener_prepped: 2.5 } })!.openerPrepped,
    ).toBe(2.5);
  });
});

describe("opener-prepped report line vs the Phase 2 label", () => {
  /** Reads a key, failing loudly rather than feeding undefined into a matcher. */
  const val = (lang: "en" | "es", key: string): string => {
    const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<
      string,
      string | undefined
    >;
    const v = dict[key];
    if (v === undefined) throw new Error(`${lang}.json is missing "${key}"`);
    return v;
  };

  for (const lang of ["en", "es"] as const) {
    it(`${lang}: reports.opening.opener_prepped starts with opening.phase2.opener_prepped_label`, () => {
      const label = val(lang, "opening.phase2.opener_prepped_label");
      const line = val(lang, "reports.opening.opener_prepped");
      expect(line.startsWith(label)).toBe(true);
      // And the journey's own regex shape holds: label, optional colon, value.
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const journeyShape = new RegExp(`^${escaped}\\s*:?\\s*7(?:\\D|$)`);
      expect(line.replace("{value}", "7")).toMatch(journeyShape);
    });
  }

  it("interpolates {value} exactly once so the number is never doubled", () => {
    for (const lang of ["en", "es"] as const) {
      expect(val(lang, "reports.opening.opener_prepped").match(/\{value\}/g)).toHaveLength(1);
    }
  });
});
