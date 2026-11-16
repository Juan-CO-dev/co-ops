import { describe, expect, it } from "vitest";
import { refundEventAmounts } from "@/lib/catering/refund-events-shared";

// W26/B140 review r1: what ONE refund gave back = its cumulative minus the highest cumulative
// of the same payment's earlier events (by event time, then id); never negative.
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
  it("same instant: ordered by event id; a lower figure after a higher one is 0, never negative", () => {
    const m = refundEventAmounts([ev("b", "p", "2026-11-10T00:00:00Z", 300), ev("a", "p", "2026-11-10T00:00:00Z", 700)]);
    expect(Object.fromEntries(m)).toEqual({ a: 700, b: 0 });
  });
});
