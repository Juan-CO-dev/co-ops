/**
 * Audit W14 / B179 — a hydrated batch row re-POSTed on its first blur.
 *
 * The page seeded the row's form value WITH its prep_data (batch object present) and its saved
 * signature WITHOUT it (batch: null), so the value-diff guard saw a "change" on an untouched
 * row and re-saved it under whoever blurred first — taking the first opener's credit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  hydratePhase2Row,
  phase2Signature,
  readPhase2SaveState,
  saveStateToFormValue,
} from "@/lib/opening-phase2-form-shared";

const phase2 = {
  phase: 2,
  closer_count: 6,
  spot_check_status: "verified",
  opener_recount: null,
  ground_truth_count: 6,
  prep_need: 2,
  opener_prepped: 2,
  delta_vs_prep_need: 0,
  over_under_status: "at_par",
  over_under_reason_category: null,
  over_under_reason_text: null,
  directed_by: null,
  saved_at: "2026-11-15T12:00:00.000Z",
  saved_by: "opener-a",
};

const batchPrepData = {
  phase2: {
    ...phase2,
    batch: {
      batches: 1,
      bottled: 2,
      came_out_to: 8,
      yield_at_time: 8,
      tossed: 0,
      tossed_reason: null,
      over_batch_reason: null,
      backup_before: 0,
      backup_after: 6,
      need_for_line: 2,
      produced_at: "2026-11-15T12:00:00.000Z",
      made_by: "opener-a",
    },
  },
};

describe("hydratePhase2Row — one hydration for the form value and its saved signature (B179)", () => {
  it("a hydrated batch row's seeded signature equals the signature of its hydrated form value", () => {
    const row = hydratePhase2Row(batchPrepData, "item-1");
    expect(row).not.toBeNull();
    expect(row!.formValue.batch).not.toBeNull();
    expect(row!.savedSignature).toBe(phase2Signature(row!.formValue));
    // What the dispatcher computes on the first untouched blur is the SAME string, so the
    // value-diff guard skips the round trip.
    const onBlur = phase2Signature({ ...row!.formValue });
    expect(onBlur).toBe(row!.savedSignature);
  });

  it("the old seed (no prep_data) is NOT that signature — the drift this bug was", () => {
    const save = readPhase2SaveState(batchPrepData)!;
    const oldSeed = phase2Signature(saveStateToFormValue(save, "item-1"));
    expect(oldSeed).not.toBe(hydratePhase2Row(batchPrepData, "item-1")!.savedSignature);
    expect(JSON.parse(oldSeed).batch).toBeNull();
  });

  it("a single-box row is unchanged (batch null on both sides)", () => {
    const prepData = { phase2 };
    const row = hydratePhase2Row(prepData, "item-2")!;
    expect(row.formValue.batch).toBeNull();
    expect(row.savedSignature).toBe(phase2Signature(saveStateToFormValue(phase2 as never, "item-2")));
  });

  it("a Phase 1 row never hydrates Phase 2 state", () => {
    expect(hydratePhase2Row({ phase1: { ground_truth_count: 6 } }, "item-3")).toBeNull();
    expect(hydratePhase2Row(null, "item-3")).toBeNull();
  });

  it("the page seeds both maps and the 409 adopt path through hydratePhase2Row only", () => {
    const page = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
    expect(page).toContain('from "@/lib/opening-phase2-form-shared"');
    // No hand-written second seed: the page never builds a form value or reads a save itself.
    expect(page).not.toMatch(/saveStateToFormValue\(/);
    expect(page).not.toMatch(/readPhase2SaveState\(/);
    expect(page.match(/hydratePhase2Row\(/g)?.length).toBe(3);
    expect(page).toContain("savedSignature: hydrated.savedSignature");
  });
});
