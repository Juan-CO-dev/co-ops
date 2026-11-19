/** Safe review projection; never includes provider payloads or customer contacts. */
export interface EzcaterReconciliationDetail {
  available: boolean;
  locationConflict: boolean;
  manualLocation: { provider: string; kept: string } | null;
  reviews: Array<{ id: string; source: "ezcater" | "toast"; code: string; candidateCount: number }>;
  linkCount: number;
  shadowRows: number;
  truncated: boolean;
  /** Item 21 PR 3 (0347): Toast checks of this order that also carry a house ring code (held, or skipped at publication),
   * counted only while the conflict still holds. A manager decides; nothing moves on its own. Fix round 2 (review
   * PORTAL3-r2 P2 #2): an unknown is never a zero. `known` = the read answered (0 is a verified zero); `not_installed`
   * = 0347 is not applied, so there is nothing to show; `unavailable` = the read failed, and the panel SAYS so.
   * Absent = not an ezCater order (nothing to compare). */
  houseConflicts?: HouseConflicts;
}

export type HouseConflicts =
  | { state: "known"; count: number }
  | { state: "not_installed" }
  | { state: "unavailable" };

/**
 * Which open review-queue rows belong to a lead (B5 #32). A lead with an ezCater
 * order reads its order's snapshot rows; a house lead reads only rows whose
 * `candidates` jsonb array names it (the `duplicate_lead` review). `candidates`
 * is JSONB, so the containment value must be a JSON array literal — the
 * postgrest-js array form `cs.{id}` is a Postgres ARRAY literal and errors on
 * jsonb, which made the panel "unavailable" on every typed lead.
 */
export type ReviewQueueScope =
  | { kind: "order"; orderId: string; snapshotId: string | null }
  | { kind: "candidate"; column: "candidates"; op: "cs"; value: string };

export function reviewQueueScope(
  order: { id: string; snapshot_id: string | null } | null,
  leadId: string,
): ReviewQueueScope {
  if (order) return { kind: "order", orderId: order.id, snapshotId: order.snapshot_id };
  return { kind: "candidate", column: "candidates", op: "cs", value: JSON.stringify([leadId]) };
}
