/**
 * D-17 (Juan 2026-10-13) — WHEN the closing checklist shows its amber AM-prep note.
 *
 * The note ("Tonight's AM prep count isn't in yet. The closer does it before lock-up.") is
 * true all day until the closer counts, so shown all day it is noise; it stays hidden until
 * 6 PM ET on the closing's business day and shows from then on. Pure, client-safe.
 */
import { etReachedClockOn } from "@/lib/operational-day";

/** The ET wall-clock time the amber AM-prep note starts showing on a closing's business day. */
export const AM_PREP_GAP_NOTE_FROM_ET = "18:00";

/** True when the closing for business day `closingDateYmd` may show the AM-prep note at `nowIso`. */
export function amPrepGapNoteDue(nowIso: string, closingDateYmd: string): boolean {
  return etReachedClockOn(nowIso, closingDateYmd, AM_PREP_GAP_NOTE_FROM_ET);
}
