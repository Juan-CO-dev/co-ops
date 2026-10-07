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

export type Phase2IncompleteReason = "needs_ground_truth" | "needs_reason" | "needs_batch";

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
