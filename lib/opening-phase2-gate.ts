/**
 * Opening Phase 2 — the per-row SAVE GATE as a pure function (client-safe, no I/O).
 *
 * The dispatcher (opening-client.tsx handlePhase2ItemSave) used to inline this. It is
 * extracted so the rule the row follows and the rule the unit spine pins are ONE statement
 * (Astra Phase A review P1 #1, BC-013/042): a batch row measures BOTTLED against the LINE
 * need (par − LINE), never Phase 1's total-based prep_need, and bottling more than that need
 * from the counted backup asks for NOTHING (Juan, addendum 2) — the over-batch reason on the
 * batch half is the only "why more" question. Under-prep capture is kept on every row.
 *
 * Mirrors the RPC: save_phase2_item_atomic skips its over-prep gate for batch rows
 * (`IF NOT v_is_batch AND v_delta > 0`) and keeps the under-prep gate.
 */
import {
  batchEntryFromForm,
  validateBatchEntry,
  type BatchEntry,
  type BatchFormValue,
  type BatchRowContext,
} from "@/lib/batch-prep-shared";

/**
 * Why a started row is not saved (the calm "incomplete" nudge, never the red "failed" badge):
 *   - "needs_ground_truth": section unverified AND no per-item recount.
 *   - "needs_reason": a non-zero delta (or an over-batch) needs its reason first.
 *   - "needs_batch": the batch half of the row is not complete yet.
 *   - "cleared_saved": the amount of an ALREADY-SAVED row was deleted. Deleting a saved amount
 *     is an Undo (owner decision W14-2 b); the row stops counting as done while that Undo is
 *     pending, was cancelled at its reason prompt, or failed — and it keeps offering Undo.
 */
export type Phase2IncompleteReason = "needs_ground_truth" | "needs_reason" | "needs_batch" | "cleared_saved";

export type Phase2GateOutcome =
  /** Nothing typed yet — the row stays "unsaved", no nudge. */
  | { kind: "blank" }
  /** A prerequisite blocks the save; the row shows the calm nudge for `reason`. */
  | { kind: "incomplete"; reason: Phase2IncompleteReason }
  /** Savable; `batchEntry` is what rides as entry.batch (null on a single-box row). */
  | { kind: "ok"; batchEntry: BatchEntry | null };

export interface Phase2GateValue {
  openerPrepped: number | null;
  openerRecount: number | null;
  overPar: unknown | null;
  underPar: { freeText: string } | null;
  batch: BatchFormValue | null;
}

export interface Phase2GateContext {
  sectionVerified: boolean;
  closerCount: number | null;
  parValue: number | null;
  /** Persisted Phase 1 ground truth / prep_need (prep_data.phase1); null before the phase1 row lands. */
  resolved: { groundTruth: number | null; prepNeed: number | null } | null;
  /** Non-null on a batch_mode item. */
  batch: BatchRowContext | null;
}

export function phase2SaveGate(v: Phase2GateValue, ctx: Phase2GateContext): Phase2GateOutcome {
  // opener_prepped is checked FIRST so a genuinely blank row reads "unsaved", not "incomplete".
  if (v.openerPrepped === null) return { kind: "blank" };

  // Ground truth from the PERSISTED Phase 1 contract; the client derivation is only the
  // pre-submit fallback (C.53 Commit B residual fix).
  const groundTruth =
    ctx.resolved?.groundTruth ??
    (v.openerRecount !== null ? v.openerRecount : ctx.sectionVerified ? ctx.closerCount : null);
  if (groundTruth === null) return { kind: "incomplete", reason: "needs_ground_truth" };

  if (ctx.batch !== null) {
    // ── Batch row: BOTTLED vs the LINE need. Over asks nothing; under keeps its reason. ──
    const need = ctx.batch.need;
    if (need !== null && v.openerPrepped - need < 0 && v.underPar === null) {
      return { kind: "incomplete", reason: "needs_reason" };
    }
    if (v.underPar && !v.underPar.freeText.trim()) return { kind: "incomplete", reason: "needs_reason" };
    if (ctx.batch.blocked || ctx.batch.backupBefore === null) return { kind: "incomplete", reason: "needs_batch" };
    const form = v.batch ?? { batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null };
    const batchEntry = batchEntryFromForm(form, ctx.batch.yieldPerBatch);
    const check = validateBatchEntry(batchEntry, {
      bottled: v.openerPrepped,
      backupBefore: ctx.batch.backupBefore,
      need,
      yieldPerBatch: ctx.batch.yieldPerBatch,
    });
    if (!check.ok) {
      return {
        kind: "incomplete",
        reason: check.code === "over_batch_reason_missing" || check.code === "over_batch_note_required" ? "needs_reason" : "needs_batch",
      };
    }
    return { kind: "ok", batchEntry };
  }

  // ── Single-box row: today's gates, byte-for-byte in effect. ──
  if (ctx.parValue !== null) {
    const prepNeed = ctx.resolved?.prepNeed ?? Math.max(0, ctx.parValue - groundTruth);
    const delta = v.openerPrepped - prepNeed;
    if (delta > 0 && v.overPar === null) return { kind: "incomplete", reason: "needs_reason" };
    if (delta < 0 && v.underPar === null) return { kind: "incomplete", reason: "needs_reason" };
  }
  if (v.underPar && !v.underPar.freeText.trim()) return { kind: "incomplete", reason: "needs_reason" };
  return { kind: "ok", batchEntry: null };
}

/** What the dispatcher knows about a row when its amount box is blank. */
export interface Phase2BlankRow {
  status: "unsaved" | "incomplete" | "saving" | "saved" | "failed";
  /** completions.id of the live phase2 row; non-null whenever a saved entry is on file. */
  completionId: string | null;
  incompleteReason: Phase2IncompleteReason | null;
}

/**
 * Audit W14 / B180 — what a BLANK amount means for a row (the gate's "blank" outcome).
 *
 * It used to mean "nothing typed yet" for every row, so deleting an amount that was already
 * saved did nothing: the box read empty, the row still read Saved, the finalize counter still
 * counted it, and finalize submitted the old number. Owner decision W14-2 b: deleting a saved
 * amount IS an Undo.
 *   - "ignore"       — nothing is on file (or this row's Undo is already pending / a save is in
 *                      flight): the row stays as it is.
 *   - "undo"         — a saved entry is on file: the row stops counting as done
 *                      ("cleared_saved") and the ordinary revoke runs (the server still decides
 *                      silent vs reason-required; nothing is revoked without it).
 *   - "mark_cleared" — the row reads Saved but its completion id is unknown (the 409 path that
 *                      could not name the winner): it stops counting as done; there is no id to
 *                      undo, the prepper retypes the amount.
 * ONE rule read by the dispatcher (opening-client.tsx) and by the row (OpeningPrepEntry.tsx).
 */
export function phase2BlankOutcome(row: Phase2BlankRow | null | undefined): "ignore" | "undo" | "mark_cleared" {
  if (!row) return "ignore";
  if (row.status === "saving") return "ignore";
  if (row.incompleteReason === "cleared_saved") return "ignore";
  if (row.completionId !== null) return "undo";
  if (row.status === "saved") return "mark_cleared";
  return "ignore";
}
