/**
 * Pipeline — CLIENT-SAFE shared surface (stage vocabulary only; no I/O, no
 * server imports). Split from pipeline.ts on 2026-07-23: the `server-only`
 * guard on lib/supabase-server.ts surfaced PipelineClient.tsx's runtime import
 * of PIPELINE_STAGES dragging the service-role module into the client graph
 * (PR #165 CI catch — third chain). Types stay importable from pipeline.ts
 * (type-only imports are erased); only runtime values need to live here.
 */

export const PIPELINE_STAGES = ["inquiry", "quote_sent", "confirmed", "out", "completed", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Stages nothing leaves. `completed` is the event served; `lost` is the lead closed.
 * Both were already excluded from the follow-up queue (pipeline.ts TERMINAL_STAGES);
 * this makes them terminal in the MACHINE too, which is where it matters.
 */
export const TERMINAL_PIPELINE_STAGES = ["completed", "lost"] as const;

/**
 * ── THE TRANSITION TABLE (audit v2, seat C5 finding F5 · BC-036) ─────────────────────
 *
 * Before this table there was no relation at all: `moveStage`'s only validation was
 * `isPipelineStage` (a membership test over the six labels) plus a same-stage no-op, so
 * every stage could move to every other — the COMPLETE GRAPH — and `completed`/`lost` were
 * not terminal.
 *
 * THAT IS A LEDGER BUG, NOT A TIDINESS ONE. `moveStage` drives catering_prep_demand:
 * `confirmed` RESERVES, `out`/`completed` CONSUME, `lost`/`inquiry`/`quote_sent` RELEASE.
 * All three of reserve/consume/release guard on `status = 'reserved'`, so a CONSUMED set is
 * invisible to the re-reserve's own idempotency sweep. Move a completed lead back to
 * `confirmed` — one mis-tap in a six-option selector — and `reservePrepDemand` retires
 * nothing and inserts a fresh full reserved set from the same quote. The ledger then holds
 * a consumed AND a reserved copy of one event's demand; W4b SKU-demand, the shortfall
 * advisory and prep planning each see it twice, and moving forward again consumes the
 * duplicate permanently.
 *
 * THE RULE, in one line: FORWARD IS ALWAYS FINE · BACKWARD ONLY WHILE THE DEMAND IS STILL
 * MERELY RESERVED · `lost` IS ALWAYS REACHABLE · NOTHING LEAVES A TERMINAL STAGE.
 *
 *   · Forward, skips included. A walk-in quoted, confirmed and out the door in one
 *     afternoon must not be forced through four taps, and a skip is ledger-safe: consume
 *     is a no-op when nothing was reserved.
 *   · Backward from `confirmed` to `quote_sent` or `inquiry`. Both RELEASE, which is
 *     precisely the undo of this stage's reserve. Backward from `quote_sent` to `inquiry`
 *     likewise — nothing is reserved yet.
 *   · NO backward edge out of `out`. Its demand is CONSUMED, and `out → confirmed` is the
 *     re-reserve directly while `out → quote_sent → confirmed` is the same thing in two
 *     hops — which is why terminality alone would not have been the whole fix.
 *   · `lost` from every non-terminal stage. Closing a lead is the one move the machine
 *     must never block, and it releases the reserved demand on the way out.
 *
 * A SAME-STAGE MOVE IS NOT A TRANSITION. `canTransition(s, s)` is false for every stage;
 * `moveStage` answers the idempotent re-tap with its own early return BEFORE asking here.
 * Saying "true" would have this table endorse a self-edge on a terminal stage.
 *
 * NOT YET WIRED — NAMED FOLLOW-UP. `lib/catering/pipeline.ts` is owned by another open PR
 * in this fix program, so `moveStage` does not call `canTransition` yet. The wiring is a
 * guard immediately after the `fromStage === toStage` early return, refusing with 409
 * `illegal_transition` (+ en/es keys), and it needs the second half of F5's fix shape
 * alongside it: `reservePrepDemand` must itself refuse when consumed rows already exist
 * for the quote, so the ledger is defended at its own door and not only at the caller's.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<PipelineStage, readonly PipelineStage[]>> = {
  inquiry: ["quote_sent", "confirmed", "out", "completed", "lost"],
  quote_sent: ["inquiry", "confirmed", "out", "completed", "lost"],
  confirmed: ["inquiry", "quote_sent", "out", "completed", "lost"],
  out: ["completed", "lost"],
  completed: [],
  lost: [],
};

/**
 * PURE: may a lead move from `from` to `to`?
 *
 * TOTAL — an unknown label in either position is REFUSED rather than crashed on. A legacy
 * or hand-edited row can carry a stage outside the vocabulary (`moveStage` already tolerates
 * one: `fromStage` is null when `isPipelineStage` says no), and refusing is the safe answer
 * — repairing such a row is a job for a path that knows what it is looking at.
 */
export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  const allowed = LEGAL_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}
