/**
 * DRAG, KEYBOARD AND STALE-RESPONSE MATHS — pure (Scheduling Phase 2, Task 22; plan r2 P3-13). SSR cannot fire pointer
 * or keyboard events, so the board's interactions are proven here and the real walk (pointer drag, keyboard
 * adjustment, cancelled step-up, stale-response recovery at 375 px, en + es) is CC's browser sim (Task 26).
 *
 *  - `dragToOp(pxDelta, pxPerQ, handle, shift)`: pixels → whole 15-minute steps (rounded; under half a step is no op)
 *    → the edit vocabulary (`edit-shared`): the bar moves, an edge sets the start / end, a divider moves the boundary
 *    before segment `index`.
 *  - `keyToOp(key, handle, shift)`: ArrowLeft / ArrowRight = −15 / +15 min on the same handles.
 *  - `editBody`: the exact `edit` body the route accepts (`SCHEDULE_ACTIONS.edit`).
 *  - `editReducer`: one edit in flight at a time; an answer to an older request (seq) or computed against another head
 *    is DISCARDED; `head_moved` reloads the head with "Someone else changed this week — your view is updated"; any
 *    other refusal snaps the bar back and names itself.
 */
import type { EditOp, ShiftRef } from "@/lib/scheduling/edit-shared";

export type Handle = { kind: "move" } | { kind: "start" } | { kind: "end" } | { kind: "divider"; index: number };
export interface HandleShift { ref: ShiftRef; startQ: number; endQ: number; segments: ReadonlyArray<{ startQ: number; endQ: number }> }

/** One step of `dq` quarters on a handle, as an edit op; null when there is no movement or no such divider. */
export function stepOp(dq: number, handle: Handle, shift: HandleShift): EditOp | null {
  if (!Number.isInteger(dq) || dq === 0) return null;
  switch (handle.kind) {
    case "move": return { kind: "move", shift: shift.ref, deltaQ: dq };
    case "start": return { kind: "start", shift: shift.ref, toQ: shift.startQ + dq };
    case "end": return { kind: "end", shift: shift.ref, toQ: shift.endQ + dq };
    case "divider": {
      const seg = shift.segments[handle.index];
      if (handle.index < 1 || !seg) return null;
      return { kind: "divider", shift: shift.ref, index: handle.index, toQ: seg.startQ + dq };
    }
  }
}

/** Pixels dragged → whole quarter steps (rounded half away from zero), then the op. */
export function dragToOp(pxDelta: number, pxPerQ: number, handle: Handle, shift: HandleShift): EditOp | null {
  if (!(pxPerQ > 0) || !Number.isFinite(pxDelta)) return null;
  const raw = pxDelta / pxPerQ;
  const dq = Math.sign(raw) * Math.round(Math.abs(raw));
  return stepOp(dq, handle, shift);
}

export function keyToOp(key: string, handle: Handle, shift: HandleShift): EditOp | null {
  if (key === "ArrowLeft") return stepOp(-1, handle, shift);
  if (key === "ArrowRight") return stepOp(1, handle, shift);
  return null;
}

export function editBody(at: { locationId: string; weekStart: string; expectedHead: string }, op: EditOp) {
  return { action: "edit" as const, locationId: at.locationId, weekStart: at.weekStart, expectedHead: at.expectedHead, op };
}

export interface EditState {
  head: string;
  seq: number;
  pending: { expectedHead: string; seq: number } | null;
  /** The head moved under us: the board reloads and says so. */
  notice: "head_moved" | null;
  /** A named refusal (an `edit_*` / schedule code), shown until the next edit. */
  error: string | null;
  /** The board should reload the head (router.refresh()). */
  reload: boolean;
  /** Bumped on every refusal: the dragged bar returns to its saved place. */
  snapBack: number;
}
export type EditAction =
  | { type: "submit" }
  | { type: "accepted"; seq: number; expectedHead: string; revisionId: string }
  | { type: "refused"; seq: number; expectedHead: string; code: string }
  | { type: "reloaded"; head: string };

export const initialEditState = (head: string): EditState => ({ head, seq: 0, pending: null, notice: null, error: null, reload: false, snapBack: 0 });

export function editReducer(s: EditState, a: EditAction): EditState {
  switch (a.type) {
    case "submit": {
      const seq = s.seq + 1;
      return { ...s, seq, pending: { expectedHead: s.head, seq }, error: null, notice: null };
    }
    case "accepted":
    case "refused": {
      // A stale answer — to an older request, or computed against a head that is no longer ours — is discarded.
      if (!s.pending || a.seq !== s.pending.seq || a.expectedHead !== s.head) return s;
      if (a.type === "accepted") return { ...s, head: a.revisionId, pending: null, reload: true, error: null, notice: null };
      if (a.code === "head_moved") return { ...s, pending: null, reload: true, notice: "head_moved", error: null };
      return { ...s, pending: null, reload: false, error: a.code, snapBack: s.snapBack + 1 };
    }
    case "reloaded":
      // Astra chunk F P2-2: a NEW head replaces any request made against the old one. Its late answer is then discarded
      // (no pending), so the board is never left disabled. A reload to the same head keeps the request in flight.
      return { ...s, head: a.head, reload: false, pending: s.pending && s.pending.expectedHead !== a.head ? null : s.pending };
  }
}
