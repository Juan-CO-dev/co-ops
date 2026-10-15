/**
 * B11a-floor — "Made the need": one tap on a prep row (opening Phase 2, mid-day Phase 2) that
 * fills the amount with the row's prep need and runs the row's EXISTING save — the same route
 * and RPC as typing the number, so the record is identical (delta 0, at par, saved_by/at
 * stamped). No "how it was entered" field anywhere. Pure, client-safe.
 *
 * The button is offered only when it means something:
 *   · a numeric need exists (no par / unresolved ground truth → no button);
 *   · the row is not already SAVED at that need;
 *   · NOT on a batch row (0215): there the number is BOTTLED for the line out of the bulk
 *     container and the save also needs the batch half (batches made, came out to, toss) —
 *     "made the need" would either be refused or record bottles without a batch session;
 *   · not read-only.
 */
export function canMakeTheNeed(args: {
  need: number | null;
  isBatch: boolean;
  readOnly: boolean;
  /** The amount currently in the box (null = empty/invalid). */
  current: number | null;
  /** True when the row's last save is live and current. */
  saved: boolean;
}): boolean {
  if (args.readOnly || args.isBatch) return false;
  if (args.need === null || !Number.isFinite(args.need) || args.need < 0) return false;
  if (args.saved && args.current === args.need) return false;
  return true;
}
