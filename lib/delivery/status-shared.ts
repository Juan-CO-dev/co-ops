/**
 * Catering delivery (D1) — statuses, the manual moves and THE derived job state (plan r6 sections 4.3, 4.8).
 * Zero I/O, no clock. Client-safe.
 *
 *  - CURRENT STATUS = the event with the highest `seq`. A time a person entered ("picked up at 10:40") is information
 *    only; it never orders anything.
 *  - THE LATEST JOB = the highest `attemptNo`. Never a time (times can be backdated).
 *  - MANUAL MOVES: people record `accepted` ("Booked"), `picked_up`, `delivered`, `cancelled`, `failed`. The table
 *    below is the SQL writer's (`delivery_manual_move_allowed`); both run tests/fixtures/delivery/manual-transition-cases.json.
 *  - `deliveryStateOf` is the ONE rule every surface reads a lead's delivery through. `cancel_needed` and
 *    `pickup_mismatch` are DERIVED at read time, so every path into a rejection or a transfer is covered with no
 *    writer re-emitted. There is no "late" state: with no provider ETA, lateness would be a guess.
 */
import { DELIVERY_STATUSES, type DeliveryLeadStage, type DeliveryState, type DeliveryStatus, type OrderQuoteKind } from "./types-shared";
import { isHouseDeliveryOrder, orderRejected } from "./quote-shared";

export const TERMINAL_STATUSES = ["delivered", "cancelled", "failed", "returned"] as const satisfies readonly DeliveryStatus[];
/** What a person may record. */
export const MANUAL_STATUSES = ["accepted", "picked_up", "delivered", "cancelled", "failed"] as const satisfies readonly DeliveryStatus[];
export type ManualDeliveryStatus = (typeof MANUAL_STATUSES)[number];
/** The legal manual moves. Nothing leaves a terminal status. */
export const MANUAL_MOVES: Readonly<Partial<Record<DeliveryStatus, readonly ManualDeliveryStatus[]>>> = {
  accepted: ["picked_up", "delivered", "cancelled", "failed"],
  picked_up: ["delivered", "failed", "cancelled"],
};

export function isDeliveryStatus(v: unknown): v is DeliveryStatus {
  return typeof v === "string" && (DELIVERY_STATUSES as readonly string[]).includes(v);
}
export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
export function manualMoveAllowed(from: string, to: string): boolean {
  if (!isDeliveryStatus(from)) return false;
  return (MANUAL_MOVES[from] as readonly string[] | undefined)?.includes(to) ?? false;
}

/** The phase of an OPEN job. Null for a terminal status. */
export function deliveryPhase(status: DeliveryStatus): "booked" | "on_the_way" | null {
  if (status === "requested" || status === "accepted" || status === "driver_assigned") return "booked";
  if (isTerminalStatus(status)) return null;
  return "on_the_way";
}

/** The latest job = the highest attemptNo. */
export function latestJob<T extends { attemptNo: number }>(jobs: readonly T[]): T | null {
  let best: T | null = null;
  for (const j of jobs) if (!best || j.attemptNo > best.attemptNo) best = j;
  return best;
}

/** A pickup decision answers only for the destination shop it was made for (another transfer raises the mismatch again). */
export function keptForShop(decisions: readonly { jobId: string; leadLocationId: string }[], jobId: string, shopId: string | null): boolean {
  return shopId !== null && decisions.some((d) => d.jobId === jobId && d.leadLocationId === shopId);
}

export interface DeliveryStateJob {
  attemptNo: number;
  status: DeliveryStatus;
  /** `closed_at is null`. */
  open: boolean;
  /** `delivery_jobs.location_id`: the shop the job was recorded for. */
  pickupShopId: string;
  /** A pickup decision exists for (this job, the lead's CURRENT shop). */
  keptForCurrentShop: boolean;
}
export interface DeliveryStateInput {
  stage: DeliveryLeadStage;
  currentShopId: string | null;
  orderQuote: { kind: OrderQuoteKind; isDelivery: boolean | null };
  isEzcater: boolean;
  /** ALL the lead's jobs, in any order. */
  jobs: readonly DeliveryStateJob[];
  /** The caller's "inside the shop's catering lead window" (it owns the clock): `to_book` reads `to_book_soon`. */
  soon?: boolean;
}

/**
 * `to_book` inside the caller's window is `to_book_soon`; every other state is returned as it is. THE one place that
 * spelling is decided: `deliveryStateOf` uses it, and so does a surface that learns "soon" only after the state was
 * derived (the day engine, which owns the clock and the shop's catering lead window).
 */
export function toBookSoon<S extends DeliveryState | "unknown">(state: S, soon: boolean): S | "to_book_soon" {
  return state === "to_book" && soon ? "to_book_soon" : state;
}

/** First match wins. `attemptNo` = the job the state is about (null when it is about no job). */
export function deliveryStateOf(input: DeliveryStateInput): { state: DeliveryState; attemptNo: number | null } {
  const rejected = orderRejected(input.stage, input.orderQuote);
  const open = latestJob(input.jobs.filter((j) => j.open));
  const latest = latestJob(input.jobs);
  const live = input.stage === "confirmed" || input.stage === "out";

  if (open) {
    // 1. A rejected order with a courier still booked.
    if (rejected) return { state: "cancel_needed", attemptNo: open.attemptNo };
    // 2. Booked for pickup at a shop the order is no longer at, and nobody said that shop still sends it.
    if (open.pickupShopId !== input.currentShopId && !open.keptForCurrentShop) return { state: "pickup_mismatch", attemptNo: open.attemptNo };
    // 3. Its phase.
    return { state: deliveryPhase(open.status) ?? "booked", attemptNo: open.attemptNo };
  }
  // 4. Nothing open; the latest job was delivered.
  if (latest?.status === "delivered") return { state: "delivered", attemptNo: latest.attemptNo };
  // 5. Nothing open; the latest job failed or came back, on an order that still has to go out.
  if (latest && (latest.status === "failed" || latest.status === "returned") && !rejected && live) return { state: "problem", attemptNo: latest.attemptNo };
  // 6. Nothing booked (none, or the latest was cancelled) on a live house delivery order.
  if ((!latest || latest.status === "cancelled") && !rejected && live && isHouseDeliveryOrder(input.isEzcater, input.orderQuote)) {
    return { state: toBookSoon("to_book", input.soon === true), attemptNo: null };
  }
  // 7. An ezCater order we have no record for: ezCater's courier, never ours to book.
  if (input.isEzcater && !latest && !rejected) return { state: "provider_managed", attemptNo: null };
  // 8. Pickup orders, leads not yet confirmed, rejected orders with nothing open.
  return { state: "none", attemptNo: null };
}
