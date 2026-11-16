/**
 * Opening Phase 2 — the persisted-row → form-value contract, CLIENT-SAFE and pure (no I/O).
 *
 * Moved out of opening-client.tsx (audit W14 / B179). The page seeds TWO things from a live
 * phase2 completion: the form value (`phase2Values`) and the row's saved signature
 * (`saveStates[].savedSignature`, the value-diff guard that skips an identical re-POST). They
 * were seeded by two hand-written call sites and drifted: the form value was built WITH the
 * row's prep_data (so a batch row carried its batch object) and the signature WITHOUT it
 * (batch: null). The first blur on a hydrated batch row therefore "differed", re-POSTed an
 * identical save, and the RPC superseded the first opener's row with a copy under the second
 * opener's name. `hydratePhase2Row` is now the ONE statement both seeds — and the 409 adopt
 * path — go through, so the signature is by construction the signature of the hydrated value.
 */
import { batchFormFromRecord, readBatchFromPrepData } from "@/lib/batch-prep-shared";
import type { OpeningPhase2FormValue } from "@/components/opening/OpeningPrepEntry";
import { isOverParReasonCategory, type OverParCapture } from "@/components/opening/OverParModal";
import { isUnderParReasonCategory, type UnderParCapture } from "@/components/opening/UnderParModal";

/**
 * Shape of a persisted Phase 2 save, as written by save_phase2_item_atomic
 * (migration 0056) into completions.prep_data->'phase2'. snake_case mirrors the
 * RPC's jsonb_build_object exactly. NOT modeled by lib/types.ts PrepData (which
 * only covers the AM-Prep inputs/snapshot shape), so it's defined locally for
 * the hydration seed. Review Gate #1: this is the persisted-row → form-value
 * contract Triad A scrutinizes before Lane B.
 *
 * Forward-bind (Triad A, Review Gate #1): promote this to lib/types.ts as a
 * PrepData union arm ({ inputs, snapshot } | { phase2 }) when the verify-then-
 * prep primitive is designed — NOT now. Widening PrepData mid-build forces every
 * existing consumer to handle the new arm; local is correct for Lane A, the
 * promotion belongs to the primitive-design pass.
 */
export interface OpeningPhase2SaveState {
  phase: 2;
  closer_count: number | null;
  spot_check_status: string | null;
  opener_recount: number | null;
  ground_truth_count: number | null;
  prep_need: number | null;
  opener_prepped: number | null;
  delta_vs_prep_need: number | null;
  over_under_status: "at_par" | "over_prep" | "under_prep";
  over_under_reason_category: string | null;
  over_under_reason_text: string | null;
  directed_by: string | null;
  saved_at: string;
  saved_by: string;
}

/**
 * Explicit prep_data ? 'phase2' filter. Under dual-membership an openingPhase2
 * item carries a phase1 row AND a phase2 row once saves exist; this guard
 * returns non-null ONLY for the phase2 row, so the phase2Values seed can never
 * incidentally hydrate from a phase1 completion.
 */
export function readPhase2SaveState(prepData: unknown): OpeningPhase2SaveState | null {
  if (prepData == null || typeof prepData !== "object") return null;
  if (!("phase2" in prepData)) return null;
  const p2 = (prepData as { phase2: unknown }).phase2;
  if (p2 == null || typeof p2 !== "object") return null;
  return p2 as OpeningPhase2SaveState;
}

/**
 * Map a persisted phase2 save onto the controlled form value. The numeric beats
 * (openerRecount, openerPrepped) always hydrate. The over/under capture is
 * reconstructed from over_under_status, but the persisted reason category is an
 * UNTYPED text column — so it's validated at the boundary against the canonical
 * vocabulary (isOver/UnderParReasonCategory, derived from the modals' REASON_
 * OPTIONS). An unrecognized category does NOT get blind-cast in: the capture is
 * left null (forcing the operator to re-pick, since the numeric that triggered
 * over/under still hydrates) and a console.warn makes the bad value observable
 * rather than silently swallowed. (Review Gate #1 required fix.)
 */
export function saveStateToFormValue(
  s: OpeningPhase2SaveState,
  itemId: string,
  /** 0215 — the row's whole prep_data, so the persisted batch object (phase2.batch) hydrates too. */
  prepData?: unknown,
): OpeningPhase2FormValue {
  const batchRecord = prepData === undefined ? null : readBatchFromPrepData(prepData);
  let overPar: OverParCapture | null = null;
  if (s.over_under_status === "over_prep") {
    const cat = s.over_under_reason_category;
    if (cat != null && isOverParReasonCategory(cat)) {
      overPar = {
        reasonCategory: cat,
        directedBy: s.directed_by,
        freeText: s.over_under_reason_text,
      };
    } else if (process.env.NODE_ENV === "development") {
      // Dev-only observability (projects F7): operators/managers should not see
      // this hydration noise in DevTools during support calls.
      console.warn(
        `[opening] Phase 2 hydration: invalid over-par reasonCategory ${JSON.stringify(
          cat,
        )} on item ${itemId} (saved_at=${s.saved_at}); leaving capture unset for re-pick.`,
      );
    }
  }

  let underPar: UnderParCapture | null = null;
  if (s.over_under_status === "under_prep") {
    const cat = s.over_under_reason_category;
    if (cat != null && isUnderParReasonCategory(cat)) {
      underPar = {
        reasonCategory: cat,
        freeText: s.over_under_reason_text ?? "",
      };
    } else if (process.env.NODE_ENV === "development") {
      // Dev-only observability (projects F7) — see the over-par branch above.
      console.warn(
        `[opening] Phase 2 hydration: invalid under-par reasonCategory ${JSON.stringify(
          cat,
        )} on item ${itemId} (saved_at=${s.saved_at}); leaving capture unset for re-pick.`,
      );
    }
  }

  return {
    openerRecount: s.opener_recount,
    openerPrepped: s.opener_prepped,
    overPar,
    underPar,
    // Panel confirmation is not persisted into the phase2 completion's read-back
    // shape (it lives on the productions ledger). A hydrated row starts untouched;
    // the server re-derives the default on any subsequent blur-save.
    confirmedConsumption: null,
    batch: batchRecord ? batchFormFromRecord(batchRecord) : null,
  };
}

/**
 * Serialize the persistable beats of a Phase 2 form value into a stable string
 * for value-diff dedup. Mirrors the /api/opening/prep/item route body shape
 * exactly: openerPrepped + the over/under captures, in the same field order the
 * route validates. openerRecount is intentionally EXCLUDED — recount is a
 * Phase 1 (verify-beat) concern, not in the route body, and a recount change
 * alone must not trigger a Phase 2 save. Used both to seed savedSignature from a
 * hydrated save and to compute the current signature at dispatch time, so the
 * two are computed by the identical code path and can be compared safely.
 */
export function phase2Signature(v: OpeningPhase2FormValue): string {
  return JSON.stringify({
    openerPrepped: v.openerPrepped,
    overPar: v.overPar
      ? {
          reasonCategory: v.overPar.reasonCategory,
          directedBy: v.overPar.directedBy,
          freeText: v.overPar.freeText,
        }
      : null,
    underPar: v.underPar
      ? {
          reasonCategory: v.underPar.reasonCategory,
          freeText: v.underPar.freeText,
        }
      : null,
    // Production-in-prep fold — MUST fold in the panel confirmation, else a
    // panel-only edit (same openerPrepped/over/under) produces an identical
    // signature and the value-diff guard silently skips the re-POST that would
    // persist the confirmed consumption.
    confirmedConsumption: v.confirmedConsumption,
    // 0215 — the batch half rides the signature for the same reason (a stepper tap with
    // the same bottled number must still POST). null on single-box rows, so their
    // signature only gains a constant key.
    batch: v.batch
      ? { batches: v.batch.batches, cameOutTo: v.batch.cameOutTo, tossed: v.batch.tossed, overBatchReason: v.batch.overBatchReason }
      : null,
  });
}

export interface HydratedPhase2Row {
  save: OpeningPhase2SaveState;
  /** The controlled form value, batch half included. */
  formValue: OpeningPhase2FormValue;
  /** `phase2Signature(formValue)` — what the value-diff guard compares the next blur against. */
  savedSignature: string;
}

/**
 * The ONE hydration of a live phase2 completion: its form value AND the signature of that
 * same value. Returns null for a row that is not a phase2 row (the Phase 1 sibling).
 */
export function hydratePhase2Row(prepData: unknown, itemId: string): HydratedPhase2Row | null {
  const save = readPhase2SaveState(prepData);
  if (!save) return null;
  const formValue = saveStateToFormValue(save, itemId, prepData);
  return { save, formValue, savedSignature: phase2Signature(formValue) };
}
