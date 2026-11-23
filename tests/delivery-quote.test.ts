/**
 * Catering delivery D1 — THE one order-quote selection (plan r6 section 4.8). `orderQuoteOf` is pinned against the same
 * case file the SQL twin (delivery_order_quote / delivery_order_rejected) runs in scripts/sql-harness-0356.mjs.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/delivery/order-quote-cases.json";
import { isHouseDeliveryOrder, orderQuoteOf, orderRejected } from "@/lib/delivery/quote-shared";
import type { QuoteCandidate } from "@/lib/delivery/types-shared";

const qid = (n: number) => `00000000-0000-4000-4100-${String(n).padStart(12, "0")}`;
interface CaseQuote { n: number; status: string; isDelivery: boolean; gratuityCents: number; deliveryFeeCents: number; createdAt: string; superseded: boolean }
/** The loader's own definition of a candidate: the live (non-superseded) revision of each family. */
const candidates = (quotes: CaseQuote[]): QuoteCandidate[] => quotes.filter((q) => !q.superseded).map((q) => ({
  id: qid(q.n), status: q.status as QuoteCandidate["status"], isDelivery: q.isDelivery, gratuityCents: q.gratuityCents,
  deliveryFeeCents: q.deliveryFeeCents, createdAt: q.createdAt,
}));

describe("orderQuoteOf equals the shared case file", () => {
  it("has the accepted / sibling / ambiguous / rejected / pending / none rows", () => {
    const kinds = new Set(fixture.cases.map((c) => c.expect.kind));
    expect([...kinds].sort()).toEqual(["accepted", "ambiguous", "none", "pending", "rejected"]);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(17);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const list = candidates(c.quotes as CaseQuote[]);
    for (const order of [list, [...list].reverse()]) {
      const got = orderQuoteOf(order);
      expect(got.kind).toBe(c.expect.kind);
      expect(got.isDelivery).toBe(c.expect.isDelivery);
      expect("quote" in got ? got.quote.id : null).toBe(c.expect.quote === null ? null : qid(c.expect.quote));
      expect(orderRejected("confirmed", got)).toBe(c.expect.rejected);
    }
  });
});

describe("what the kinds mean", () => {
  const q = (over: Partial<QuoteCandidate>): QuoteCandidate =>
    ({ id: qid(1), status: "accepted", isDelivery: true, gratuityCents: 0, deliveryFeeCents: 0, createdAt: "2026-11-01T10:00:00Z", ...over });

  it("only accepted carries the quote the fee and the gratuity are read from", () => {
    const accepted = orderQuoteOf([q({ gratuityCents: 1234, deliveryFeeCents: 2500 })]);
    expect(accepted).toMatchObject({ kind: "accepted", quote: { gratuityCents: 1234, deliveryFeeCents: 2500 } });
    expect(orderQuoteOf([q({}), q({ id: qid(2) })])).toEqual({ kind: "ambiguous", isDelivery: true });
    expect(orderQuoteOf([q({ status: "declined" })])).toEqual({ kind: "rejected", isDelivery: false });
    expect(orderQuoteOf([])).toEqual({ kind: "none", isDelivery: null });
  });

  it("pending compares created_at as an instant, whatever its spelling", () => {
    const older = q({ id: qid(9), status: "sent", createdAt: "2026-11-06T10:00:00+00:00" });
    const newer = q({ id: qid(1), status: "sent", createdAt: "2026-11-06T06:00:01-05:00" });
    expect(orderQuoteOf([older, newer])).toMatchObject({ kind: "pending", quote: { id: qid(1) } });
  });

  it("rejected = the lead is lost OR the order quote is rejected", () => {
    expect(orderRejected("lost", { kind: "accepted", isDelivery: true })).toBe(true);
    expect(orderRejected("lost", { kind: "none", isDelivery: null })).toBe(true);
    expect(orderRejected("confirmed", { kind: "rejected", isDelivery: false })).toBe(true);
    for (const kind of ["accepted", "ambiguous", "pending", "none"] as const) expect(orderRejected("confirmed", { kind, isDelivery: true })).toBe(false);
  });

  it("a house delivery order = not ezCater and known to be a delivery", () => {
    expect(isHouseDeliveryOrder(false, { kind: "accepted", isDelivery: true })).toBe(true);
    expect(isHouseDeliveryOrder(true, { kind: "accepted", isDelivery: true })).toBe(false);
    expect(isHouseDeliveryOrder(false, { kind: "accepted", isDelivery: false })).toBe(false);
    expect(isHouseDeliveryOrder(false, { kind: "none", isDelivery: null })).toBe(false);
  });
});
