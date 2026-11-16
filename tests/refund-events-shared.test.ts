import { describe, expect, it } from "vitest";
import { refundEventAmounts } from "@/lib/catering/refund-events-shared";

// W26/B140 review r1: what ONE refund gave back = its cumulative minus the highest cumulative
// of the same payment's earlier events (by cumulative figure — review r2 — then event time, then id); never negative.
const ev = (id: string, payment: string, at: string, cum: number) => ({ stripe_event_id: id, payment_id: payment, refunded_at: at, cumulative_refunded_cents: cum });

describe("refundEventAmounts", () => {
  it("successive partial refunds then completion: $10, then $90", () => {
    const m = refundEventAmounts([ev("b", "p", "2026-11-11T00:00:00Z", 10000), ev("a", "p", "2026-11-10T00:00:00Z", 1000)]);
    expect(Object.fromEntries(m)).toEqual({ a: 1000, b: 9000 });
  });
  it("payments are independent; a repeated total under another id is 0", () => {
    const m = refundEventAmounts([
      ev("a", "p", "2026-11-10T00:00:00Z", 1000), ev("dup", "p", "2026-11-10T01:00:00Z", 1000),
      ev("x", "q", "2026-11-10T00:00:00Z", 500),
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: 1000, dup: 0, x: 500 });
  });
  it("same instant: ordered by the cumulative figure, not the event id (review r2)", () => {
    const m = refundEventAmounts([ev("b", "p", "2026-11-10T00:00:00Z", 300), ev("a", "p", "2026-11-10T00:00:00Z", 700)]);
    expect(Object.fromEntries(m)).toEqual({ b: 300, a: 400 });
  });
});

// W26/B140 review r2: the amount must not depend on where the stored times came from. A backfilled
// row can carry a delivery time while a live row carries Stripe's own time, so the order is the
// charge's CUMULATIVE figure (monotonic per charge); time is only the tiebreak.
describe("refundEventAmounts — cumulative order, whatever times are stored (review r2)", () => {
  it("the reviewer's probe: $10 then $90 is 10 and 90 even when the $100 event is stamped EARLIER", () => {
    const m = refundEventAmounts([ev("partial", "p", "2026-11-12T00:00:00Z", 1000), ev("final", "p", "2026-11-10T00:00:00Z", 10000)]);
    expect(Object.fromEntries(m)).toEqual({ partial: 1000, final: 9000 });
  });
  it("same with equal times and ids that sort the other way", () => {
    const m = refundEventAmounts([ev("a_final", "p", "2026-11-10T00:00:00Z", 10000), ev("z_partial", "p", "2026-11-10T00:00:00Z", 1000)]);
    expect(Object.fromEntries(m)).toEqual({ z_partial: 1000, a_final: 9000 });
  });
  it("a repeated cumulative: the earlier-stamped one carries the amount, the other 0; never negative", () => {
    const m = refundEventAmounts([ev("late", "p", "2026-11-11T00:00:00Z", 1000), ev("early", "p", "2026-11-10T00:00:00Z", 1000), ev("big", "p", "2026-11-09T00:00:00Z", 2500)]);
    expect(Object.fromEntries(m)).toEqual({ early: 1000, late: 0, big: 1500 });
    for (const v of m.values()) expect(v).toBeGreaterThanOrEqual(0);
  });
});
