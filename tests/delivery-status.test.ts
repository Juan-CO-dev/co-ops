/**
 * Catering delivery D1 — the status vocabulary, the manual moves and THE derived job state (plan r6 section 4.3, 4.8).
 * The manual move table is pinned against the same case file the SQL twin (delivery_manual_move_allowed) runs in
 * scripts/sql-harness-0356.mjs.
 */
import { describe, expect, it } from "vitest";
import moves from "./fixtures/delivery/manual-transition-cases.json";
import { DELIVERY_STATUSES } from "@/lib/delivery/types-shared";
import {
  deliveryPhase, deliveryStateOf, isTerminalStatus, keptForShop, latestJob, MANUAL_MOVES, MANUAL_STATUSES, manualMoveAllowed, TERMINAL_STATUSES,
  type DeliveryStateInput, type DeliveryStateJob,
} from "@/lib/delivery/status-shared";

const A = "shop-a", B = "shop-b";
const job = (attemptNo: number, status: DeliveryStateJob["status"], over: Partial<DeliveryStateJob> = {}): DeliveryStateJob =>
  ({ attemptNo, status, open: !isTerminalStatus(status), pickupShopId: A, keptForCurrentShop: false, ...over });
const input = (over: Partial<DeliveryStateInput> = {}): DeliveryStateInput =>
  ({ stage: "confirmed", currentShopId: A, orderQuote: { kind: "accepted", isDelivery: true }, isEzcater: false, jobs: [], ...over });
const state = (over: Partial<DeliveryStateInput> = {}) => deliveryStateOf(input(over)).state;

describe("the vocabulary", () => {
  it("twelve canonical statuses, four terminal, five manual", () => {
    expect(DELIVERY_STATUSES).toEqual(["requested", "accepted", "driver_assigned", "en_route_pickup", "at_pickup", "picked_up",
      "en_route_dropoff", "at_dropoff", "delivered", "cancelled", "failed", "returned"]);
    expect(TERMINAL_STATUSES).toEqual(["delivered", "cancelled", "failed", "returned"]);
    expect(MANUAL_STATUSES).toEqual(["accepted", "picked_up", "delivered", "cancelled", "failed"]);
    for (const s of DELIVERY_STATUSES) expect(isTerminalStatus(s)).toBe((TERMINAL_STATUSES as readonly string[]).includes(s));
  });

  it("the manual moves equal the shared case file (the SQL twin runs the same file)", () => {
    expect(moves.length).toBeGreaterThanOrEqual(146);
    for (const c of moves) expect([c.from, c.to, manualMoveAllowed(c.from, c.to)]).toEqual([c.from, c.to, c.allowed]);
  });

  it("nothing leaves a terminal status; every manual target is a manual status", () => {
    for (const t of TERMINAL_STATUSES) expect(MANUAL_MOVES[t]).toBeUndefined();
    for (const targets of Object.values(MANUAL_MOVES)) for (const t of targets!) expect(MANUAL_STATUSES).toContain(t);
  });

  it("phases: booked before pickup, on the way from en route to at drop-off", () => {
    expect(["requested", "accepted", "driver_assigned"].map((s) => deliveryPhase(s as never))).toEqual(["booked", "booked", "booked"]);
    expect(["en_route_pickup", "at_pickup", "picked_up", "en_route_dropoff", "at_dropoff"].map((s) => deliveryPhase(s as never))).toEqual(Array(5).fill("on_the_way"));
    for (const t of TERMINAL_STATUSES) expect(deliveryPhase(t)).toBeNull();
  });
});

describe("the latest job is the highest attempt_no, never a time", () => {
  it("latestJob picks by attemptNo whatever the order", () => {
    expect(latestJob([job(2, "cancelled"), job(3, "accepted"), job(1, "delivered")])?.attemptNo).toBe(3);
    expect(latestJob([])).toBeNull();
  });

  it("a mistaken delivered job 1 beside a cancelled replacement job 2 reads to_book, not delivered", () => {
    expect(state({ jobs: [job(1, "delivered"), job(2, "cancelled")] })).toBe("to_book");
    expect(state({ jobs: [job(2, "cancelled"), job(1, "delivered")] })).toBe("to_book");
  });
});

describe("deliveryStateOf: first match wins", () => {
  it("1. a rejected order with an open job is cancel_needed (lost lead, or every quote declined)", () => {
    expect(state({ stage: "lost", jobs: [job(1, "accepted")] })).toBe("cancel_needed");
    expect(state({ orderQuote: { kind: "rejected", isDelivery: false }, jobs: [job(1, "picked_up")] })).toBe("cancel_needed");
    // ... and it outranks a pickup mismatch.
    expect(state({ stage: "lost", currentShopId: B, jobs: [job(1, "accepted")] })).toBe("cancel_needed");
    expect(deliveryStateOf(input({ stage: "lost", jobs: [job(1, "cancelled"), job(2, "accepted")] }))).toEqual({ state: "cancel_needed", attemptNo: 2 });
  });

  it("2. an open job whose pickup shop is not the lead's shop is pickup_mismatch until kept for THAT shop", () => {
    expect(state({ currentShopId: B, jobs: [job(1, "accepted")] })).toBe("pickup_mismatch");
    expect(state({ currentShopId: B, jobs: [job(1, "accepted", { keptForCurrentShop: true })] })).toBe("booked");
    expect(state({ currentShopId: null, jobs: [job(1, "accepted")] })).toBe("pickup_mismatch");
    // A closed job is history, never a mismatch.
    expect(state({ currentShopId: B, jobs: [job(1, "delivered")] })).toBe("delivered");
  });

  it("3. an open job reads its phase", () => {
    expect(state({ jobs: [job(1, "accepted")] })).toBe("booked");
    expect(state({ jobs: [job(1, "picked_up")] })).toBe("on_the_way");
    expect(state({ jobs: [job(1, "at_dropoff")] })).toBe("on_the_way");
    // In every lead stage that is not a rejection.
    expect(state({ stage: "completed", jobs: [job(1, "picked_up")] })).toBe("on_the_way");
  });

  it("4. no open job and the latest delivered is delivered, rejected or not", () => {
    expect(state({ jobs: [job(1, "cancelled"), job(2, "delivered")] })).toBe("delivered");
    expect(state({ stage: "lost", jobs: [job(1, "delivered")] })).toBe("delivered");
    expect(state({ stage: "completed", jobs: [job(1, "delivered")] })).toBe("delivered");
  });

  it("5. the latest failed or returned on a live order is a problem", () => {
    expect(state({ jobs: [job(1, "failed")] })).toBe("problem");
    expect(state({ stage: "out", jobs: [job(1, "returned")] })).toBe("problem");
    expect(state({ stage: "completed", jobs: [job(1, "failed")] })).toBe("none");
    expect(state({ stage: "lost", jobs: [job(1, "failed")] })).toBe("none");
    expect(state({ orderQuote: { kind: "rejected", isDelivery: false }, jobs: [job(1, "failed")] })).toBe("none");
    // An ezCater order's failed courier is a problem too (the rule does not ask who booked it).
    expect(state({ isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, jobs: [job(1, "failed")] })).toBe("problem");
  });

  it("6. a confirmed house delivery order with nothing booked is to_book (to_book_soon when the caller says soon)", () => {
    expect(state()).toBe("to_book");
    expect(state({ stage: "out" })).toBe("to_book");
    expect(state({ jobs: [job(1, "cancelled")] })).toBe("to_book");
    expect(state({ soon: true })).toBe("to_book_soon");
    expect(state({ orderQuote: { kind: "pending", isDelivery: true } })).toBe("to_book");
    expect(state({ orderQuote: { kind: "ambiguous", isDelivery: true } })).toBe("to_book");
    // Not yet confirmed, finished, a pickup, an unknown delivery-ness, a rejection: never to_book.
    for (const stage of ["inquiry", "quote_sent", "completed", "lost"] as const) expect(state({ stage })).toBe("none");
    expect(state({ orderQuote: { kind: "accepted", isDelivery: false } })).toBe("none");
    expect(state({ orderQuote: { kind: "none", isDelivery: null } })).toBe("none");
    expect(state({ orderQuote: { kind: "rejected", isDelivery: false } })).toBe("none");
    expect(state({ soon: true, orderQuote: { kind: "accepted", isDelivery: false } })).toBe("none");
  });

  it("7. an ezCater lead with no job is provider_managed, never to_book", () => {
    expect(state({ isEzcater: true, orderQuote: { kind: "none", isDelivery: null } })).toBe("provider_managed");
    expect(state({ isEzcater: true, orderQuote: { kind: "accepted", isDelivery: true }, soon: true })).toBe("provider_managed");
    expect(state({ isEzcater: true, stage: "lost" })).toBe("none");
    // With a job, the job speaks.
    expect(state({ isEzcater: true, jobs: [job(1, "accepted")] })).toBe("booked");
    expect(state({ isEzcater: true, orderQuote: { kind: "none", isDelivery: null }, jobs: [job(1, "cancelled")] })).toBe("none");
  });

  it("carries the attempt the state is about", () => {
    expect(deliveryStateOf(input({ jobs: [job(1, "cancelled"), job(2, "picked_up")] }))).toEqual({ state: "on_the_way", attemptNo: 2 });
    expect(deliveryStateOf(input({ jobs: [job(1, "cancelled")] }))).toEqual({ state: "to_book", attemptNo: null });
    expect(deliveryStateOf(input({ jobs: [job(1, "delivered")] }))).toEqual({ state: "delivered", attemptNo: 1 });
    expect(deliveryStateOf(input({ stage: "inquiry" }))).toEqual({ state: "none", attemptNo: null });
  });
});

describe("keptForShop: a pickup decision answers only for the shop it was made for", () => {
  const decisions = [{ jobId: "j1", leadLocationId: B }];
  it("A -> B kept; -> C is a mismatch again; back at B still kept", () => {
    expect(keptForShop(decisions, "j1", B)).toBe(true);
    expect(keptForShop(decisions, "j1", "shop-c")).toBe(false);
    expect(keptForShop(decisions, "j2", B)).toBe(false);
    expect(keptForShop(decisions, "j1", null)).toBe(false);
  });
});
